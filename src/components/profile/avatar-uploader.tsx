"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Camera, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeAvatarAction, uploadAvatarAction } from "@/server/actions/avatar";
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES, avatarUrlFor } from "@/lib/avatar";
import { UserAvatar } from "@/components/profile/user-avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * Avatar management on the settings page.
 *
 * Deliberately not a drag-and-drop target: a plain file input, triggered by a
 * real button, is keyboard reachable, works with a screen reader, and behaves
 * identically on every phone browser. Drop targets are where "click to choose"
 * quietly stops working.
 *
 * Validation happens on the server, from the bytes. The checks here are
 * conveniences that save the user a round trip and make the limit visible
 * before they pick a file — never the thing that decides whether a file is
 * acceptable.
 */
export function AvatarUploader({
  avatarPath,
  displayName,
}: {
  avatarPath: string | null;
  displayName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [removing, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // An optimistic preview, so the new picture appears the instant it is chosen
  // rather than after a round trip. `replaces` is the stored URL this preview
  // is standing in for, which is how we know when the server has caught up and
  // the blob can be discarded.
  const [preview, setPreview] = useState<{
    url: string;
    replaces: string | null;
  } | null>(null);

  const serverUrl = avatarUrlFor(avatarPath);
  const busy = pending || removing;

  // Show the optimistic blob only while the server has not yet caught up. Once
  // `avatarPath` resolves to the very URL the preview was standing in for, the
  // real image is displayed and the blob is out of the picture. Deriving this
  // during render rather than clearing it in an effect keeps it correct even if
  // the refreshed props arrive before the action's promise settles.
  const shown =
    preview && serverUrl !== preview.replaces ? preview.url : serverUrl;

  // Revoke the blob when a new one takes its place, and on unmount.
  //
  // The dependency is the URL, NOT the `preview` object. The object is replaced
  // with a new identity when `replaces` is filled in after a successful upload,
  // and depending on the object made React run that cleanup at exactly the wrong
  // moment: the blob being revoked was the one still rendered in the preview.
  // The result was `net::ERR_FILE_NOT_FOUND` and a broken image in the one place
  // a user goes to check that their picture uploaded — measured in production,
  // with the console error captured, not inferred.
  //
  // Depending on the URL string means the cleanup fires only when the rendered
  // URL genuinely changes, so the release always matches what left the screen.
  const previewUrl = preview?.url ?? null;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the value so picking the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;

    setError(null);

    if (file.size > AVATAR_MAX_BYTES) {
      setError(
        "That image is larger than 2 MB. Try a smaller picture — a phone photo resized to fit works well."
      );
      return;
    }

    setPreview({ url: URL.createObjectURL(file), replaces: null });

    const form = new FormData();
    form.set("avatar", file);

    startTransition(async () => {
      try {
        const result = await uploadAvatarAction(form);
        if (!result.ok) {
          setError(result.message);
          // The optimistic preview did not survive; fall back to what is stored.
          setPreview(null);
          toast.error(result.message);
          return;
        }
        // Record what the server will report back, so the effect above knows
        // when the real image has arrived to replace this blob.
        setPreview((p) => (p ? { ...p, replaces: result.avatarUrl } : p));
        toast.success("Picture updated.");
      } catch {
        setError("We couldn't upload that picture. Please try again.");
        setPreview(null);
        toast.error("We couldn't upload that picture.");
      }
    });
  }

  function onRemove() {
    setError(null);
    startRemoving(async () => {
      try {
        const result = await removeAvatarAction();
        if (!result.ok) {
          setError(result.message);
          toast.error(result.message);
          return;
        }
        setPreview(null);
        toast.success("Picture removed.");
      } catch {
        setError("We couldn't remove that picture. Please try again.");
        toast.error("We couldn't remove that picture.");
      }
    });
  }

  return (
    <section aria-labelledby="avatar-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="avatar-heading" className="text-base font-semibold tracking-tight">
          Profile picture
        </h2>
        <p className="text-sm text-muted-foreground">
          A square JPEG, PNG, WebP or GIF, up to 2 MB. It appears next to your
          name wherever you take part in a sale.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-full border bg-muted">
          {/*
            Two sources, and the split is deliberate.

            A local blob: the file the user just picked, shown while the upload
            is in flight. It cannot 404, so it needs no error handling of its
            own, and it is deliberately NOT routed through `UserAvatar` — that
            component accepts a storage key and builds the URL itself, precisely
            so no caller can hand it an arbitrary origin. Adding a raw-URL
            escape hatch for this one case would weaken that guarantee to save
            a few lines.

            Everything else: `UserAvatar`, with the real key. That is where the
            broken-object case actually bites. This preview used to be its own
            implementation, and a picture removed on another device, or one the
            CDN has not caught up with, rendered as a torn image in the one
            place a user is actively managing their picture. It now falls back
            to initials exactly like the header and the profile do.
          */}
          {preview && serverUrl !== preview.replaces ? (
            <Image
              src={preview.url}
              alt=""
              fill
              unoptimized
              sizes="80px"
              className="object-cover"
              data-testid="avatar-preview-blob"
            />
          ) : (
            <UserAvatar
              avatarPath={avatarPath}
              name={displayName}
              pixelSize={80}
              className="size-20"
            />
          )}
          {busy && (
            <span
              className="absolute inset-0 grid place-items-center bg-background/70 text-[11px] font-medium"
              role="status"
            >
              {pending ? "Uploading" : "Removing"}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              aria-busy={pending}
              data-testid="avatar-upload-button"
            >
              <Camera aria-hidden />
              {shown ? "Change picture" : "Upload a picture"}
            </Button>

            {shown && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRemove}
                disabled={busy}
                aria-busy={removing}
                data-testid="avatar-remove-button"
              >
                <Trash2 aria-hidden />
                Remove
              </Button>
            )}
          </div>

          {/* Visually hidden but still in the accessibility tree and still
              focusable, so keyboard and screen-reader users get the native file
              dialog rather than an inaccessible custom control.

              A PLAIN <input>, deliberately not the shared `Input`. `Input`
              carries `w-full`, and `sr-only` only wins on `width` if it is
              emitted later in the stylesheet — which is not something a
              component should depend on. When `w-full` won, the absolutely
              positioned input was as wide as its container while sitting at its
              static position, and pushed the mobile page 132px sideways. That is
              a real horizontal-overflow bug on a real phone, measured in
              production, and it came from reusing a styled input for something
              that must have no styling. */}
          <div className="space-y-1.5">
            <Label htmlFor="avatar-input" className="sr-only">
              Profile picture file
            </Label>
            <input
              ref={inputRef}
              id="avatar-input"
              type="file"
              accept={AVATAR_ACCEPT}
              onChange={onPick}
              className="sr-only"
              tabIndex={shown ? -1 : 0}
              data-testid="avatar-file-input"
            />
            <p className="text-xs text-muted-foreground">
              {shown
                ? "Your current picture will be replaced."
                : "Without a picture, we show your initials."}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          data-testid="avatar-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </section>
  );
}
