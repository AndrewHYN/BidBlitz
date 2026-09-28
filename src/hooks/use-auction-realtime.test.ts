import { describe, expect, it } from "vitest";
import {
  admitEventTime,
  MAX_EVENT_FUTURE_SKEW_MS,
} from "@/hooks/use-auction-realtime";

/**
 * Realtime payloads are attacker-controlled input.
 *
 * The auction channels are public, so anybody holding the publishable key can
 * post to `auction:{id}`. The values in an event end up driving the `status`
 * handed to the bid panel, so before this rule existed two shapes of forgery
 * both won the "newest source" comparison and overwrote the server-rendered
 * facts in every other viewer's browser:
 *
 *   - an event with no `serverTime` at all, which fell back to the client mount
 *     time and therefore always beat the server snapshot;
 *   - an event claiming a timestamp far in the future.
 *
 * Either one could make a live auction render as ended, which removes the bid
 * form for every viewer until they reload.
 */
const FLOOR = Date.parse("2026-09-28T12:00:00.000Z");

describe("admitEventTime()", () => {
  it("admits an event the server just published", () => {
    const r = admitEventTime(
      { type: "bid.accepted", serverTime: "2026-09-28T12:00:03.000Z" },
      FLOOR
    );
    expect(r.admitted).toBe(true);
    expect(r.stamped).toBe(FLOOR + 3_000);
  });

  it("admits a genuine event on a page that has been open a long time", () => {
    // The bound tracks forward, so this is about a floor the client has already
    // advanced to - not one pinned to page render.
    const advanced = FLOOR + 3_600_000;
    const r = admitEventTime(
      { type: "auction.updated", serverTime: "2026-09-28T13:00:05.000Z" },
      advanced
    );
    expect(r.admitted).toBe(true);
  });

  it("admits an event that is slightly behind the newest known time", () => {
    // Out-of-order delivery between two channels is normal and must not be
    // treated as forgery.
    const r = admitEventTime(
      { type: "auction.extended", serverTime: "2026-09-28T11:59:58.000Z" },
      FLOOR
    );
    expect(r.admitted).toBe(true);
  });

  it("admits an event up to exactly the allowed skew", () => {
    const atLimit = new Date(FLOOR + MAX_EVENT_FUTURE_SKEW_MS).toISOString();
    expect(admitEventTime({ serverTime: atLimit }, FLOOR).admitted).toBe(true);
  });

  it("rejects an event with no serverTime - the original silent bypass", () => {
    // This is the shape that used to win automatically, because the caller fell
    // back to the client mount time.
    const r = admitEventTime(
      { type: "auction.updated", status: "ENDED", currentBidMinor: "1" },
      FLOOR
    );
    expect(r.admitted).toBe(false);
    expect(Number.isNaN(r.stamped)).toBe(true);
  });

  it("rejects an empty or unparseable serverTime", () => {
    for (const serverTime of ["", "not-a-date", "null", "   "]) {
      expect(admitEventTime({ serverTime }, FLOOR).admitted).toBe(false);
    }
  });

  it("admits a far-past but parseable time - it cannot win on freshness", () => {
    // `Date.parse` is lenient ("0" is year 2000), so a backdated event is
    // admitted here. That is safe by construction: the component only renders
    // an event whose timestamp is >= the server-rendered snapshot, so anything
    // in the past simply loses and the server's own values stand.
    const r = admitEventTime({ serverTime: "2000-01-01T00:00:00.000Z" }, FLOOR);
    expect(r.admitted).toBe(true);
    expect(r.stamped).toBeLessThan(FLOOR);
  });

  it("rejects a timestamp far in the future", () => {
    const r = admitEventTime({ serverTime: "2099-01-01T00:00:00.000Z" }, FLOOR);
    expect(r.admitted).toBe(false);
  });

  it("rejects a timestamp just past the allowed skew", () => {
    const justOver = new Date(
      FLOOR + MAX_EVENT_FUTURE_SKEW_MS + 1_000
    ).toISOString();
    expect(admitEventTime({ serverTime: justOver }, FLOOR).admitted).toBe(false);
  });

  it("rejects non-objects and null", () => {
    for (const bad of [null, undefined, 42, "auction.updated", []]) {
      expect(admitEventTime(bad, FLOOR).admitted).toBe(false);
    }
  });

  it("bounds the skew generously enough for a real deployment", () => {
    // Genuine events publish immediately after COMMIT, so a minute and a half
    // is already orders of magnitude more headroom than needed. If this ever
    // needs raising, the cause is a slow publish, not a forged payload.
    expect(MAX_EVENT_FUTURE_SKEW_MS).toBeGreaterThanOrEqual(60_000);
    expect(MAX_EVENT_FUTURE_SKEW_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});
