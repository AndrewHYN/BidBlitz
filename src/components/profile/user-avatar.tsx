import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarUrlFor, initialsFor } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * The one avatar used everywhere a person is shown.
 *
 * Three guarantees, in order of how much they matter:
 *
 *  1. **No remote image source, ever.** The only input is a storage key; the
 *     URL is built here from our own bucket, and a key that is not one of ours
 *     (or that is not a key at all) is refused rather than rendered.
 *  2. **Never a broken image.** Radix swaps to the fallback whenever the image
 *     fails to load, so a dead object, a slow network or a 404 all end at
 *     initials instead of a torn icon.
 *  3. **No layout shift.** A fixed square frame with `object-cover`, so the
 *     space is reserved before any bytes arrive at any size.
 *
 * The fallback is deterministic — the same name always yields the same two
 * letters — so a face-less profile looks identical everywhere rather than
 * shimmering between different random colours.
 */
export function UserAvatar({
  avatarPath,
  name,
  size = "default",
  className,
}: {
  /** The `profiles.avatar_path` storage key, or null. */
  avatarPath: string | null | undefined;
  /** Used only for the fallback initials. Never rendered as image alt text. */
  name: string | null | undefined;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const url = avatarUrlFor(avatarPath);
  const initials = initialsFor(name);

  return (
    <Avatar size={size} className={cn(className)} data-testid="user-avatar">
      {url ? <AvatarImage src={url} alt="" /> : null}
      <AvatarFallback aria-hidden={url ? undefined : "true"}>{initials}</AvatarFallback>
    </Avatar>
  );
}
