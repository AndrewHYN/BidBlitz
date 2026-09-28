"use client";

import { useState } from "react";
import Image from "next/image";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarUrlFor, initialsFor } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * The one avatar used everywhere a person is shown.
 *
 * Three guarantees, in order of how much they matter:
 *
 *  1. **No remote image source, ever.** The only input is a storage key; the URL
 *     is built here from our own bucket, and a key that is not one of ours (or
 *     that is not a key at all) is refused rather than rendered.
 *  2. **Never a broken image.** A load failure falls straight to the
 *     initials, so a deleted object, an expired CDN entry or a slow network
 *     all end at letters instead of a torn icon.
 *  3. **No layout shift, and no downloading the original.** The image goes
 *     through `next/image` in a fixed square frame, so the space is reserved
 *     before any bytes arrive, and a 32px header avatar fetches a 32px
 *     variant rather than a 2 MB phone photo.
 *
 * Point 3 is why this is a client component. A plain `<img src={url}>` in the
 * header — which is what Radix's `AvatarImage` does — loads the *original*
 * object from Supabase on every page for every signed-in visitor, at whatever
 * resolution it was uploaded. Measured in production: the settings preview was
 * correctly served through `/_next/image`, while the same avatar in the header
 * was fetching the raw `zteakuiuvcikwpnkgxsn.supabase.co` object.
 *
 * The fallback is deterministic — the same name always yields the same two
 * letters — so a face-less profile looks identical everywhere rather than
 * changing shape between the header and the profile page.
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
  const url = avatarUrlFor(avatarPath);
  // Cleared on a load error so a dead object shows initials rather than
  // retrying forever. Keyed by the URL so replacing a picture retries it.
  const [broken, setBroken] = useState<string | null>(null);
  const showImage = url !== null && broken !== url;
  const initials = initialsFor(name);

  const stock: Record<string, number> = { sm: 24, default: 32, lg: 40 };
  const px = pixelSize ?? stock[size] ?? 32;
  // The stock sizes have hard-coded Tailwind classes; a custom pixel size gets
  // an inline frame so the image is exactly as big as the space reserved.
  const frame =
    pixelSize === undefined
      ? undefined
      : { width: px, height: px };

  return (
    <Avatar size={size} className={cn(className)} data-testid="user-avatar">
      {showImage ? (
        <Image
          src={url}
          alt=""
          width={px}
          height={px}
          sizes={`${px}px`}
          className="aspect-square size-full rounded-full object-cover"
          data-testid="user-avatar-image"
          onError={() => setBroken(url)}
        />
      ) : null}
      <AvatarFallback aria-hidden={showImage ? undefined : "true"}>
        {frame ? <span style={frame} className="grid place-items-center">{initials}</span> : initials}
      </AvatarFallback>
    </Avatar>
  );
}
