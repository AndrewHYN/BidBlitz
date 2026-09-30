import { describe, expect, it } from "vitest";
import {
  CARD_ENDING_SOON_MS,
  CLOSED_STATUSES,
  RECENTLY_LISTED_WINDOW_HOURS,
  isBiddable,
  isClosed,
  isRecentlyListed,
  recentlyListedCutoffIso,
} from "./auction-status";

const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

function iso(deltaMs: number): string {
  return new Date(NOW + deltaMs).toISOString();
}

describe("isClosed()", () => {
  it("is true for every terminal status", () => {
    expect(isClosed("ENDED")).toBe(true);
    expect(isClosed("SOLD")).toBe(true);
    expect(isClosed("UNSOLD")).toBe(true);
    expect(isClosed("CANCELLED")).toBe(true);
  });

  it("is false for statuses that are still in play", () => {
    expect(isClosed("DRAFT")).toBe(false);
    expect(isClosed("SCHEDULED")).toBe(false);
    expect(isClosed("LIVE")).toBe(false);
    expect(isClosed("something-unknown")).toBe(false);
  });

  it("exposes exactly the terminal set", () => {
    expect([...CLOSED_STATUSES].sort()).toEqual([
      "CANCELLED",
      "ENDED",
      "SOLD",
      "UNSOLD",
    ]);
  });
});

describe("isBiddable()", () => {
  it("never allows bidding on DRAFT or terminal auctions", () => {
    expect(isBiddable("DRAFT", iso(60_000), NOW)).toBe(false);
    expect(isBiddable("ENDED", iso(60_000), NOW)).toBe(false);
    expect(isBiddable("SOLD", iso(60_000), NOW)).toBe(false);
    expect(isBiddable("UNSOLD", iso(60_000), NOW)).toBe(false);
    expect(isBiddable("CANCELLED", iso(60_000), NOW)).toBe(false);
  });

  it("treats SCHEDULED auctions as biddable ahead of their start", () => {
    expect(isBiddable("SCHEDULED", iso(60_000), NOW)).toBe(true);
    expect(isBiddable("SCHEDULED", iso(-60_000), NOW)).toBe(true);
    expect(isBiddable("SCHEDULED", null, NOW)).toBe(true);
  });

  it("allows LIVE auctions until the clock passes endsAt", () => {
    expect(isBiddable("LIVE", iso(1_000), NOW)).toBe(true);
    expect(isBiddable("LIVE", null, NOW)).toBe(true);
    expect(isBiddable("LIVE", iso(-1_000), NOW)).toBe(false);
    // exactly at endsAt the auction is no longer biddable
    expect(isBiddable("LIVE", iso(0), NOW)).toBe(false);
  });
});

describe("CARD_ENDING_SOON_MS", () => {
  it("is a ten-minute window", () => {
    expect(CARD_ENDING_SOON_MS).toBe(10 * 60_000);
  });
});

describe("RECENTLY_LISTED_WINDOW_HOURS", () => {
  it("is a single centralized 72-hour window", () => {
    expect(RECENTLY_LISTED_WINDOW_HOURS).toBe(72);
  });

  it("derives the cutoff from the given clock, not the wall clock", () => {
    expect(recentlyListedCutoffIso(NOW)).toBe(
      new Date(NOW - 72 * 3_600_000).toISOString()
    );
  });
});

describe("isRecentlyListed()", () => {
  const H = 3_600_000;

  it("includes a 2-hour-old LIVE listing", () => {
    expect(isRecentlyListed("LIVE", iso(-2 * H), NOW)).toBe(true);
  });

  it("includes a 71-hour-old LIVE listing", () => {
    expect(isRecentlyListed("LIVE", iso(-71 * H), NOW)).toBe(true);
  });

  it("excludes a 73-hour-old LIVE listing", () => {
    expect(isRecentlyListed("LIVE", iso(-73 * H), NOW)).toBe(false);
  });

  it("excludes every non-discoverable status no matter how fresh", () => {
    for (const status of [
      "DRAFT",
      "PENDING_REVIEW",
      "PAUSED",
      "SOLD",
      "UNSOLD",
      "CANCELLED",
      "ENDED",
    ]) {
      expect(isRecentlyListed(status, iso(-H), NOW)).toBe(false);
    }
  });

  it("includes SCHEDULED while it is publicly visible and fresh", () => {
    expect(isRecentlyListed("SCHEDULED", iso(-H), NOW)).toBe(true);
    expect(isRecentlyListed("SCHEDULED", iso(-73 * H), NOW)).toBe(false);
  });

  it("never treats a missing or unreadable timestamp as recent", () => {
    expect(isRecentlyListed("LIVE", null, NOW)).toBe(false);
    expect(isRecentlyListed("SCHEDULED", null, NOW)).toBe(false);
    expect(isRecentlyListed("LIVE", "not-a-date", NOW)).toBe(false);
  });

  it("never treats a future-dated timestamp as recent", () => {
    expect(isRecentlyListed("LIVE", iso(H), NOW)).toBe(false);
  });

  it("orders by listed_at, newest first (the query contract)", () => {
    const rows = [
      { status: "LIVE", listedAt: iso(-5 * H) },
      { status: "LIVE", listedAt: iso(-H) },
      { status: "SCHEDULED", listedAt: iso(-3 * H) },
    ]
      .filter((r) => isRecentlyListed(r.status, r.listedAt, NOW))
      .sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt))
      .map((r) => r.listedAt);
    expect(rows).toEqual([iso(-H), iso(-3 * H), iso(-5 * H)]);
  });
});
