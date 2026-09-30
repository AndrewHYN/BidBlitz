/**
 * Auction state helpers that are safe to import from EITHER a Server
 * Component or a Client Component.
 *
 * Anything a server module needs must NOT live in a `"use client"` file:
 * importing a plain function from a client module turns it into a client
 * reference, and calling it during SSR throws.
 */

export const CLOSED_STATUSES = new Set([
  "ENDED",
  "SOLD",
  "UNSOLD",
  "CANCELLED",
]);

/** Auction is under administrative hold: alive, but nothing may move. */
export function isPaused(status: string): boolean {
  return status === "PAUSED";
}

/** Listing is waiting for a human reviewer: not public, not biddable. */
export function isPendingReview(status: string): boolean {
  return status === "PENDING_REVIEW";
}

export function isClosed(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

/** Statuses a viewer can bid on. */
export function isBiddable(status: string, endsAt: string | null, nowMs: number): boolean {
  if (status === "SCHEDULED") return true;
  if (status !== "LIVE") return false;
  return endsAt === null || Date.parse(endsAt) > nowMs;
}

/** Window (ms) in which a LIVE auction is styled as "ending soon". */
export const CARD_ENDING_SOON_MS = 10 * 60_000;

/**
 * "Recently Listed" freshness window. A DISPLAY rule, not a lifecycle rule:
 * a listing older than this leaves the homepage rail and nothing else
 * changes - status, Browse, search, bids and history are untouched.
 * Single source: the homepage query and the predicate below both read it.
 */
export const RECENTLY_LISTED_WINDOW_HOURS = 72;

/** Server-clock ISO cutoff: listed later than this counts as recent. */
export function recentlyListedCutoffIso(nowMs: number): string {
  return new Date(nowMs - RECENTLY_LISTED_WINDOW_HOURS * 3_600_000).toISOString();
}

/**
 * Homepage "recently listed" means publicly available AND published within
 * the window. Only LIVE and SCHEDULED are publicly discoverable states that
 * can receive buyers; everything else - drafts, held, paused and closed
 * listings - is out no matter how fresh its timestamp. A missing timestamp
 * is never recent: drafts predate the listed_at column and must not sneak
 * in. The browser never decides this; the query filters server-side and the
 * predicate exists so the rule is unit-testable in one place.
 */
export function isRecentlyListed(
  status: string,
  listedAt: string | null,
  nowMs: number
): boolean {
  if (status !== "LIVE" && status !== "SCHEDULED") return false;
  if (listedAt === null) return false;
  const listedMs = Date.parse(listedAt);
  if (Number.isNaN(listedMs)) return false;
  const ageMs = nowMs - listedMs;
  return ageMs >= 0 && listedMs > Date.parse(recentlyListedCutoffIso(nowMs));
}
