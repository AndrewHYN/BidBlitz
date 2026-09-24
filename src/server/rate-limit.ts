/**
 * Deliberately simple rate limiter.
 *
 * In-memory sliding window. That is enough to blunt accidental double-taps and
 * naive scripted abuse on a single instance, and it costs nothing. It is NOT a
 * distributed defence and is documented as such — a multi-instance deployment
 * needs a shared store (Redis/Postgres), which is out of the three-day scope.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };

  // drop everything outside the window
  while (bucket.hits.length && now - bucket.hits[0] > windowMs) {
    bucket.hits.shift();
  }

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 };
}

/** Opportunistic sweep so an idle server does not retain stale buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

// Bound memory: if the map grows past this, drop the coldest entries.
setInterval(() => {
  if (buckets.size < 5000) return;
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > 600_000) {
      buckets.delete(key);
    }
  }
}, 60_000).unref?.();

export const BID_LIMIT = { limit: 30, windowMs: 10_000 };
export const AUCTION_CREATE_LIMIT = { limit: 10, windowMs: 60_000 };
export const REPORT_LIMIT = { limit: 5, windowMs: 60_000 };
export const AUTH_LIMIT = { limit: 5, windowMs: 60_000 };
