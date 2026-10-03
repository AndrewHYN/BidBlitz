import { absoluteUrl } from "@/lib/site-url";
import { safeNext } from "@/lib/safe-next";

/**
 * Canonical OAuth landing for `signInWithOAuth({ redirectTo })`.
 *
 * One builder so Google (and any future provider) can never drift from the
 * email-link callback: same canonical origin, same `/auth/callback` route,
 * same single-slash `next` rule. `safeNext` is the ONLY redirect validation
 * mechanism — an attacker-controlled `next` (e.g. `https://evil.example`)
 * falls back to `/dashboard` here, exactly as it does for email links.
 */
export function googleOAuthRedirectTo(next?: string | null): string {
  return `${absoluteUrl("/auth/callback")}?next=${encodeURIComponent(safeNext(next))}`;
}
