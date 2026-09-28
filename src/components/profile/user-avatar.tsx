"use client";

import { useState } from "react";
import Image from "next/image";
import { Avatar } from "@/components/ui/avatar";
import { avatarUrlFor, initialsFor } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * The one avatar used everywhere a person is shown.
 *
 * ## Why this exists instead of `AvatarImage`
 *
 * Radix's own `AvatarImage` is a plain `<img src>`, so the header avatar fetched
 * the *original* object from Supabase on every page for every signed-in visitor,
 * at whatever resolution it was uploaded. Measured in production: the settings
 * preview went through `/_next/image` correctly while the same avatar in the
 * header pulled the raw multi-megabyte file. So the image is `next/image`.
 *
 * ## The bug this fixes
 *
 * Because this is not Radix's `AvatarImage`, Radix's internal `status` never
 * leaves `"loading"` — nothing ever tells it an image arrived. `AvatarFallback`
 * renders whenever `status !== "loaded"`, so it was ALWAYS rendered, beside our
 * image, inside a `relative flex` root. Both `size-full`, both `rounded-full`,
 * both painted: a photograph with the initials sitting on top of it.
 *
 * A single `showImage` boolean could not fix it, because the fallback's
 * visibility was never ours to control. The fix is to stop using the
 * status-dependent component at all and own the fallback here. Radix's `Root`
 * is kept — it is a styled box and a context provider, with no status logic of
 * its own — so the frame, the border and the stock sizes are unchanged.
 *
 * ## The states, and why they are keyed by URL
 *
 *   no valid key            -> initials
 *   valid key, still loading -> initials
 *   valid key, loaded       -> the image
 *   valid key, failed       -> initials
 *
 * `loaded` and `failed` are both remembered **against the URL they refer to**.
 * That is what makes replacing a picture work: when the key changes, neither
 * matches the new URL, so the component falls back to initials and retries
 * cleanly, instead of inheriting the old image's success or its failure. A
 * single `boolean broken` cannot tell "this picture failed" from "the previous
 * picture failed".
 *
 * ## No flash
 *
 * The swap is instantaneous, with no crossfade, on purpose. A crossfade would
 * mean the photo and the letters are both painted for its duration, which is
 * exactly what is being fixed. At 24-80px the instant swap is imperceptible,
 * and the frame reserves its space either way, so there is no layout shift.
 *
 * ## Accessibility
 *
 * The image is `alt=""` and the initials are `aria-hidden`, so the avatar
 * contributes nothing to the accessibility tree. That is right for every call
 * site, because each pairs the avatar with the person's name: the profile `h1`,
 * the seller name beside the card, the account email in Settings, and the
 * header button's own `aria-label`. Without that pairing, exposing the avatar
 * would only repeat the letters immediately after the name was announced.
 */
export function UserAvatar({
  avatarPath,
  name,
  size = "default",
  className,
  pixelSize,
}: {
  /** The `profiles.avatar_path` storage key, or null. */
  avatarPath: string | null | undefined;
  /** Used only for the fallback initials. Never rendered as image alt text. */
  name: string | null | undefined;
  size?: "sm" | "default" | "lg";
  className?: string;
  /**
   * The rendered width in CSS pixels, when the surface is not a stock size.
   * Drives both the fixed frame and the `sizes` hint, which is what tells the
   * optimizer which variant to build. A wrong value here is a wrong-size
   * image, so pass the real number rather than guessing.
   */
  pixelSize?: number;
}) {
  // The ONLY place a storage key becomes a URL. A key that is not one of ours,
  // or that is not a key at all, is refused here rather than rendered.
  const url = avatarUrlFor(avatarPath);

  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Exactly one branch is ever taken, so the image and the initials can never
  // both be in the frame. There is no code path that renders both.
  const showImage = url !== null && loadedUrl === url && failedUrl !== url;
  const initials = initialsFor(name);

  const stock: Record<string, number> = { sm: 24, default: 32, lg: 40 };
  const px = pixelSize ?? stock[size] ?? 32;
  // The stock sizes have hard-coded Tailwind classes; a custom pixel size gets
  // an inline frame so the image is exactly as big as the space reserved.
  const frame = pixelSize === undefined ? undefined : { width: px, height: px };

  return (
    <Avatar
      size={size}
      className={cn(className)}
      style={frame}
      data-testid="user-avatar"
      // Asserted by the e2e suite: this is the state, not a class that merely
      // happens to look right. "both" must be unrepresentable.
      data-avatar-state={showImage ? "image" : "initials"}
    >
      {showImage ? (
        <Image
          src={url}
          alt=""
          width={px}
          height={px}
          sizes={`${px}px`}
          className="size-full rounded-full object-cover"
          data-testid="user-avatar-image"
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span
          aria-hidden="true"
          data-testid="user-avatar-initials"
          className={cn(
            "grid size-full place-items-center rounded-full bg-muted",
            "text-muted-foreground",
            size === "sm" ? "text-xs" : pixelSize && pixelSize > 40 ? "text-lg" : "text-sm"
          )}
        >
          {initials}
        </span>
      )}
    </Avatar>
  );
}
