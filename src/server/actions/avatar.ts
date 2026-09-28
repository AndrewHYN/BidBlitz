"use server";

/**
 * Avatar upload and removal.
 *
 * Why this is a server action and not a direct browser upload to Supabase
 * Storage: the two things that must never be trusted — the file's real type and
 * the folder it lands in — are both decided here, from the bytes and from the
 * session. A client-side upload with permissive storage policies is exactly how
 * a user ends up writing into someone else's folder, or uploading something
 * that is not an image at all.
 *
 * What this action does NOT do: resize, re-encode, or crop. That needs an image
 * pipeline this project deliberately does not depend on. The controls are a
 * 2 MB cap, magic-byte type detection, SVG excluded, and a fixed square frame in
 * the UI so nothing shifts. Server-side resizing is recorded in
 * docs/POST_LAUNCH_BACKLOG.md.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  AVATAR_BUCKET,
  AVATAR_MAX_BYTES,
  avatarKeyFor,
  avatarUrlFor,
  validateAvatarBytes,
  type AvatarExt,
} from "@/lib/avatar";

export type AvatarResult =
  | {
      ok: true;
      avatarUrl: string | null;
      ext: AvatarExt | null;
      /**
       * The storage key that is now stored, or null when the picture was removed.
       *
       * Returned so the client can render the confirmed picture immediately
       * instead of waiting for a revalidation round trip to hand it back. This is
       * a KEY, not a URL, which is the point: `UserAvatar` builds the URL itself
       * and refuses anything that is not a key in our own bucket, so handing it
       * a key changes nothing about the security model. Returning a URL would
       * mean a caller-supplied origin could reach the component, which is exactly
       * the escape hatch the component is built to prevent.
       *
       * The key is derived server-side from the verified session, so it is not
       * caller-controlled, and the database independently refuses any value
       * outside the caller's own folder.
       */
      avatarKey: string | null;
    }
  | { ok: false; message: string };

/**
 * The whole point of the file being here: the destination folder is
 * `auth.uid()` from the verified session. Nothing the client sends influences
 * where a byte is written.
 */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null };
  return { supabase, user };
}

export async function uploadAvatarAction(
  formData: FormData
): Promise<AvatarResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "Sign in to upload a picture." };

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image first." };
  }

  // Cheap gate before the buffer is materialised, so an enormous upload is
  // refused without reading it all into memory.
  if (file.size > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      message:
        "That image is larger than 2 MB. Try a smaller picture. A phone photo resized to fit works well.",
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateAvatarBytes(bytes);
  if (!validated.ok) return { ok: false, message: validated.reason };

  const key = avatarKeyFor(user.id, validated.ext);

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(key, bytes, {
      // `upsert` is the replacement path: one avatar per user, at one
      // deterministic key, so changing your picture cannot accumulate objects
      // and cannot leave an orphan the moment a user tries to change it again.
      upsert: true,
      // The type we DETECTED, never the type the browser claimed. The bytes
      // already passed `validateAvatarBytes`, so this is the truth about the
      // file - whereas `file.type` is whatever the uploader felt like sending.
      // Passing that through would let a real JPEG be stored, and served, as
      // whatever the request claimed.
      contentType: mimeFor(validated.ext),
      // One hour, not a year. This image is REVOCABLE: the user can remove
      // their picture, and after that the object is gone from storage while the
      // public bucket URL keeps serving the old bytes from Supabase's CDN until
      // the entry expires. Verified in production: after a removal that
      // succeeded at the database AND the storage layer, GET on the public URL
      // still returned 200 with the deleted image. A year would mean a photo
      // someone chose to remove stays retrievable from a known URL for a year.
      //
      // One hour bounds that window to something a person would accept, and
      // costs only an origin read per avatar per hour. A version counter in the
      // key would remove the window entirely, but it would trade away the
      // deterministic one-object-per-user property that stops replacements
      // accumulating orphans — a worse trade. Recorded in the ADR.
      cacheControl: "3600",
    });

  if (uploadError) {
    // Never surface the raw storage error: it can name internal objects.
    console.error("[avatar] upload failed", uploadError.message);
    return {
      ok: false,
      message: "We couldn't upload that picture. Please try again.",
    };
  }

  // Point the profile at it. The database independently refuses any value
  // outside the caller's own folder (migration 20260928000004), so this update
  // cannot be talked into recording someone else's key.
  const { data: updated, error: profileError } = await supabase
    .from("profiles")
    .update({ avatar_path: key })
    .eq("id", user.id)
    .select("username")
    .maybeSingle();

  if (profileError) {
    // The object is uploaded but the profile does not reference it, so remove
    // it again rather than leave an unreferenced object in the bucket.
    await supabase.storage.from(AVATAR_BUCKET).remove([key]);
    console.error("[avatar] profile update failed", profileError.message);
    return {
      ok: false,
      message: "We couldn't save that picture. Nothing was changed, so please try again.",
    };
  }

  /*
   * Revalidate every surface that can show the picture, not just the obvious one.
   *
   * `revalidatePath("/", "layout")` refreshes the header, which lives in the root
   * layout and is on every page. It does NOT re-render the `/settings` page
   * segment, which is where the user is standing and where the preview sits. That
   * omission was a real bug, found by looking at the rendered page: uploading a
   * picture updated the header avatar immediately while the preview kept showing
   * initials, and the state sat at "initials" for as long as the page was open.
   *
   * The three paths below are the complete set of places a stored avatar is
   * rendered. A new one needs adding here, or it will show the previous picture
   * until an unrelated navigation happens to revalidate it.
   */
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  if (updated?.username) revalidatePath(`/profile/${updated.username}`);

  return { ok: true, avatarUrl: avatarUrlFor(key), ext: validated.ext, avatarKey: key };
}

export async function removeAvatarAction(): Promise<AvatarResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, message: "Sign in first." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_path, username")
    .eq("id", user.id)
    .maybeSingle();

  const key = profile?.avatar_path ?? null;
  if (key) {
    // Scoped by the storage policy to this user's folder, so a stale or
    // tampered value cannot be used to delete somebody else's object.
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([key]);
    if (error) {
      console.error("[avatar] remove failed", error.message);
      return {
        ok: false,
        message: "We couldn't remove that picture. Please try again.",
      };
    }
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", user.id);

  if (profileError) {
    console.error("[avatar] profile clear failed", profileError.message);
    return {
      ok: false,
      message: "We couldn't update your profile. Please try again.",
    };
  }

  // Same three surfaces as the upload, for the same reason. Removing a picture
  // left the /settings preview showing the old image for the rest of the visit.
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  if (profile?.username) revalidatePath(`/profile/${profile.username}`);
  return { ok: true, avatarUrl: null, ext: null, avatarKey: null };
}

/**
 * The browser's own idea of the content type is only used when it supplied
 * something at all; when it is absent or obviously wrong, the type detected
 * from the bytes is what gets stored.
 */
function mimeFor(ext: AvatarExt): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
  }
}
