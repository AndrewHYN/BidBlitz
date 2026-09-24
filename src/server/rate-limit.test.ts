import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUCTION_CREATE_LIMIT,
  AUTH_LIMIT,
  BID_LIMIT,
  REPORT_LIMIT,
  rateLimit,
  resetRateLimits,
} from "./rate-limit";

beforeEach(() => {
  resetRateLimits();
  // rateLimit() reads Date.now(); fake only the clock so the module's own
  // (real, unref'd) interval is left alone.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  resetRateLimits();
  vi.useRealTimers();
});

describe("rateLimit()", () => {
  it("allows up to the limit inside the window", () => {
    expect(rateLimit("allow", 3, 1_000)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });
    expect(rateLimit("allow", 3, 1_000)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });
    expect(rateLimit("allow", 3, 1_000)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
  });

  it("blocks the next call with remaining 0 and a retry hint", () => {
    rateLimit("block", 2, 1_000);
    rateLimit("block", 2, 1_000);

    const blocked = rateLimit("block", 2, 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(1_000);
  });

  it("allows again once the window has passed", () => {
    rateLimit("window", 1, 500);
    expect(rateLimit("window", 1, 500).allowed).toBe(false);

    vi.advanceTimersByTime(600);

    const after = rateLimit("window", 1, 500);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(0);
    expect(after.retryAfterMs).toBe(0);
  });

  it("keeps keys independent", () => {
    rateLimit("key-a", 1, 1_000);
    expect(rateLimit("key-a", 1, 1_000).allowed).toBe(false);

    const other = rateLimit("key-b", 1, 1_000);
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(0);
  });

  it("resetRateLimits() clears the buckets", () => {
    rateLimit("fresh", 1, 10_000);
    expect(rateLimit("fresh", 1, 10_000).allowed).toBe(false);

    resetRateLimits();

    expect(rateLimit("fresh", 1, 10_000).allowed).toBe(true);
  });

  it("exports the documented limit constants", () => {
    expect(BID_LIMIT).toEqual({ limit: 30, windowMs: 10_000 });
    expect(AUCTION_CREATE_LIMIT).toEqual({ limit: 10, windowMs: 60_000 });
    expect(REPORT_LIMIT).toEqual({ limit: 5, windowMs: 60_000 });
    expect(AUTH_LIMIT).toEqual({ limit: 5, windowMs: 60_000 });
  });
});
