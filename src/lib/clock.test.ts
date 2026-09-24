import { beforeEach, describe, expect, it } from "vitest";
import {
  ENDING_SOON_MS,
  countdownParts,
  formatRemaining,
  getOffsetMs,
  isSynced,
  msRemaining,
  resetClock,
  serverNow,
  setOffsetFromMeasurement,
} from "./clock";

/** Fixed local "now" so every arithmetic expectation is deterministic. */
const NOW = 1_700_000_000_000;

function iso(deltaMs: number): string {
  return new Date(NOW + deltaMs).toISOString();
}

beforeEach(() => {
  resetClock();
});

describe("setOffsetFromMeasurement()", () => {
  it("discounts half the round-trip from the measured offset", () => {
    // sent at local 1_000_000, received 400ms later; server claimed 1_500_000
    setOffsetFromMeasurement(1_500_000, 1_000_000, 1_000_400);
    // offset = serverTime - (sent + rtt/2) = 1_500_000 - 1_000_200
    expect(getOffsetMs()).toBe(499_800);
    expect(isSynced()).toBe(true);
  });

  it("treats a negative round trip as zero", () => {
    setOffsetFromMeasurement(2_000_000, 1_000_000, 900_000);
    expect(getOffsetMs()).toBe(1_000_000);
    expect(isSynced()).toBe(true);
  });
});

describe("serverNow()", () => {
  it("applies the measured offset", () => {
    setOffsetFromMeasurement(1_500_000, 1_000_000, 1_000_400);
    expect(serverNow(1_000_000)).toBe(1_499_800);
  });

  it("passes local time through while unsynced", () => {
    expect(isSynced()).toBe(false);
    expect(getOffsetMs()).toBe(0);
    expect(serverNow(123_456)).toBe(123_456);
  });
});

describe("msRemaining()", () => {
  it("measures against the server clock, not the local one", () => {
    // sent at NOW, received 1s later, server said NOW+5s -> offset +4500
    setOffsetFromMeasurement(NOW + 5_000, NOW, NOW + 1_000);
    expect(getOffsetMs()).toBe(4_500);
    expect(msRemaining(iso(14_500), NOW)).toBe(10_000);
  });

  it("goes negative once the end time has passed", () => {
    expect(msRemaining(iso(-1_000), NOW)).toBe(-1_000);
    expect(msRemaining(iso(60_000), NOW)).toBe(60_000);
  });
});

describe("countdownParts()", () => {
  it("splits the remaining time into d/h/m/s", () => {
    const total = ((2 * 24 + 4) * 3600 + 13 * 60 + 5) * 1000;
    const parts = countdownParts(iso(total), NOW);
    expect(parts.totalMs).toBe(total);
    expect(parts.days).toBe(2);
    expect(parts.hours).toBe(4);
    expect(parts.minutes).toBe(13);
    expect(parts.seconds).toBe(5);
    expect(parts.expired).toBe(false);
    expect(parts.endingSoon).toBe(false);
  });

  it("is expired exactly at the end time", () => {
    const parts = countdownParts(iso(0), NOW);
    expect(parts.totalMs).toBe(0);
    expect(parts.expired).toBe(true);
    expect(parts.endingSoon).toBe(false);
    expect(parts.days + parts.hours + parts.minutes + parts.seconds).toBe(0);
  });

  it("flags ending-soon inside the threshold but not beyond it", () => {
    expect(countdownParts(iso(1_000), NOW).endingSoon).toBe(true);
    expect(countdownParts(iso(ENDING_SOON_MS), NOW).endingSoon).toBe(true);
    expect(countdownParts(iso(ENDING_SOON_MS), NOW).expired).toBe(false);
    expect(countdownParts(iso(ENDING_SOON_MS + 1), NOW).endingSoon).toBe(false);
    expect(countdownParts(iso(-1), NOW).expired).toBe(true);
  });
});

describe("formatRemaining()", () => {
  it("renders the documented labels", () => {
    expect(formatRemaining(iso(-1), NOW)).toBe("Ended");
    expect(formatRemaining(iso(((2 * 24 + 4) * 3600) * 1000), NOW)).toBe("2d 4h");
    expect(formatRemaining(iso((3 * 3600 + 2 * 60) * 1000), NOW)).toBe("3h 2m");
    expect(formatRemaining(iso((13 * 60 + 5) * 1000), NOW)).toBe("13m 05s");
    expect(formatRemaining(iso(45_000), NOW)).toBe("45s");
  });
});

describe("resetClock()", () => {
  it("restores the unsynced, zero-offset state", () => {
    setOffsetFromMeasurement(1_500_000, 1_000_000, 1_000_400);
    expect(isSynced()).toBe(true);
    expect(getOffsetMs()).not.toBe(0);

    resetClock();

    expect(isSynced()).toBe(false);
    expect(getOffsetMs()).toBe(0);
    expect(serverNow(4_242)).toBe(4_242);
    expect(msRemaining(iso(60_000), NOW)).toBe(60_000);
  });
});
