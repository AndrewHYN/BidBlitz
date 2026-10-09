import { describe, expect, it } from "vitest";
import { countFromQuery, queueLabel, queueState } from "./queue-health";

describe("operations queue health", () => {
  it("does not present failed or forbidden reads as zero", () => {
    expect(countFromQuery({ count: 0, error: { message: "RLS denied" } })).toBeNull();
    expect(countFromQuery({ count: null, error: null })).toBeNull();
    expect(countFromQuery(null)).toBeNull();
    expect(queueLabel(null)).toBe("Unavailable");
    expect(queueState(null)).toBe("unavailable");
  });

  it("distinguishes empty, pending and urgent work", () => {
    expect(queueState(0)).toBe("clear");
    expect(queueState(1)).toBe("attention");
    expect(queueState(9)).toBe("attention");
    expect(queueState(10)).toBe("urgent");
    expect(queueState(5, 5)).toBe("urgent");
  });

  it("rejects invalid database counts", () => {
    expect(countFromQuery({ count: -1, error: null })).toBeNull();
    expect(queueState(Number.NaN)).toBe("unavailable");
    expect(queueState(Number.POSITIVE_INFINITY)).toBe("unavailable");
    expect(queueState(-1)).toBe("unavailable");
    expect(countFromQuery({ count: 14, error: null })).toBe(14);
  });
});
