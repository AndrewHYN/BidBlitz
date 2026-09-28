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
  | { ok: true; avatarUrl: string | null; ext: AvatarExt | null }
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

  // The avatar appears in the site header, which is in the ROOT LAYOUT, so it
  // is on every page. Revalidating only /settings would leave the header
  // showing the old picture everywhere else until something else happened to
  // revalidate. This is a rare, deliberate, user-initiated action, so
  // invalidating the layout is the correct cost - and a stale avatar on every
  // page is the visible alternative.
  revalidatePath("/", "layout");
  if (updated?.username) revalidatePath(`/profile/${updated.username}`);

  return { ok: true, avatarUrl: avatarUrlFor(key), ext: validated.ext };
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

  revalidatePath("/", "layout");
  if (profile?.username) revalidatePath(`/profile/${profile.username}`);
  return { ok: true, avatarUrl: null, ext: null };
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
