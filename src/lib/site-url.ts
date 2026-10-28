/**
 * Explicit application origin for registered auth/payment callbacks, plus the
 * final public origin for search metadata and sharing. Vercel serves www as
 * primary; older callback allowlists still contain the bare domain.
 *
 * `NEXT_PUBLIC_` is inlined at build time, so this works in server components
 * and client components alike. Trailing slashes are stripped once here — the
 * deployed env value carries one, and every consumer appends "/" itself.
 */
// Production callback fallback remains the registered bare-domain origin. The
// deployed `NEXT_PUBLIC_SITE_URL` still wins; this only applies when it is
// absent, and it must never silently fall back to the legacy
// `bid-blitz-ten.vercel.app` deployment, which is historical, not canonical.
const fallback = process.env.NODE_ENV === "production"
  ? "https://bidblitz.co.zw"
  : "http://localhost:3000";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? fallback).replace(/\/+$/, "");
export const CANONICAL_SITE_URL = SITE_URL === "https://bidblitz.co.zw"
  ? "https://www.bidblitz.co.zw"
  : SITE_URL;

/** Absolute URL for a site-relative path: absoluteUrl("/auction/x"). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function canonicalUrl(path: string): string {
  return `${CANONICAL_SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
