import { describe, expect, it } from "vitest";
import {
  CARD_ENDING_SOON_MS,
  CLOSED_STATUSES,
  isBiddable,
  isClosed,
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
