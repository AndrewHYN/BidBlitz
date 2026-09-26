/**
 * The canonical site origin — ONE definition for every absolute URL BidBlitz
 * produces: sitemap, robots, canonical/og:url, auth email redirects and the
 * share buttons (§7: the shared link must be the canonical production domain,
 * never whatever origin the current page happens to be served from).
 *
 * `NEXT_PUBLIC_` is inlined at build time, so this works in server components
 * and client components alike. Trailing slashes are stripped once here — the
 * deployed env value carries one, and every consumer appends "/" itself.
 */
const fallback = process.env.NODE_ENV === "production"
  ? "https://bid-blitz-ten.vercel.app"
  : "http://localhost:3000";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? fallback).replace(/\/+$/, "");

/** Absolute URL for a site-relative path: absoluteUrl("/auction/x"). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
