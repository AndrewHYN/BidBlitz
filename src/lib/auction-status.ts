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
