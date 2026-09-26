import { describe, expect, it } from "vitest";
import {
  exponentFor,
  feePercentLabel,
  formatMoney,
  money,
  nextMinimumBid,
  parseMoneyToMinor,
  previewFeeMinor,
  symbolFor,
} from "./money";

describe("money()", () => {
  it("normalises minor units and upper-cases the currency", () => {
    expect(money(250000n)).toEqual({ minor: 250000n, currency: "USD" });
    expect(money("41050", "usd")).toEqual({ minor: 41050n, currency: "USD" });
    expect(money(1000, "jpy")).toEqual({ minor: 1000n, currency: "JPY" });
  });
});

describe("exponentFor()", () => {
  it("uses zero minor units for zero-decimal currencies", () => {
    expect(exponentFor("jpy")).toBe(0);
    expect(exponentFor("JPY")).toBe(0);
    expect(exponentFor("KRW")).toBe(0);
  });

  it("defaults to two for two-decimal and unknown currencies", () => {
    expect(exponentFor("usd")).toBe(2);
    expect(exponentFor("XYZ")).toBe(2);
  });
});

describe("symbolFor()", () => {
  it("maps ISO codes to symbols", () => {
    expect(symbolFor("USD")).toBe("$");
    expect(symbolFor("eur")).toBe("€");
    expect(symbolFor("JPY")).toBe("¥");
  });

  it("falls back to the ISO code", () => {
    expect(symbolFor("btc")).toBe("BTC ");
  });
});

describe("formatMoney()", () => {
  it("formats USD with thousands grouping and two decimals", () => {
    expect(formatMoney(money(250000n))).toBe("$2,500.00");
    expect(formatMoney(money(100000n))).toBe("$1,000.00");
    expect(formatMoney(money(1050n))).toBe("$10.50");
    expect(formatMoney(money(50n))).toBe("$0.50");
    expect(formatMoney(money(0n))).toBe("$0.00");
  });

  it("formats zero-decimal currencies without a fraction", () => {
    expect(formatMoney(money(1234n, "JPY"))).toBe("¥1,234");
  });

  it("keeps the sign for negative amounts", () => {
    expect(formatMoney(money(-2500n))).toBe("-$25.00");
  });

  it("drops grouping (but keeps decimals) in compact mode", () => {
    expect(formatMoney(money(250000n), { compact: true })).toBe("$2500.00");
  });
});

describe("parseMoneyToMinor()", () => {
  it("parses plain decimals into minor units", () => {
    expect(parseMoneyToMinor("410.50")).toBe(41050n);
    expect(parseMoneyToMinor("410.5")).toBe(41050n);
    expect(parseMoneyToMinor("410")).toBe(41000n);
    expect(parseMoneyToMinor("0.05")).toBe(5n);
  });

  it("strips grouping, whitespace and a leading currency symbol", () => {
    expect(parseMoneyToMinor("$1,000")).toBe(100000n);
    expect(parseMoneyToMinor(" 410 ")).toBe(41000n);
  });

  it("respects the currency exponent", () => {
    expect(parseMoneyToMinor("410", "JPY")).toBe(410n);
    expect(parseMoneyToMinor("410.1", "JPY")).toBeNull();
  });

  it("rejects sub-minor-unit precision", () => {
    expect(parseMoneyToMinor("1.999")).toBeNull();
  });

  it("rejects invalid input", () => {
    expect(parseMoneyToMinor("")).toBeNull();
    expect(parseMoneyToMinor("abc")).toBeNull();
    expect(parseMoneyToMinor("-5")).toBeNull();
    expect(parseMoneyToMinor("12.3.4")).toBeNull();
    expect(parseMoneyToMinor("1e3")).toBeNull();
    expect(parseMoneyToMinor(".5")).toBeNull();
    expect(parseMoneyToMinor("5.")).toBeNull();
  });
});

describe("nextMinimumBid()", () => {
  it("uses the starting bid as the floor when there are no bids yet", () => {
    expect(nextMinimumBid(null, 500n, 50n)).toBe(500n);
  });

  it("adds the increment to the current bid", () => {
    expect(nextMinimumBid(2500n, 500n, 50n)).toBe(2550n);
  });
});

describe("previewFeeMinor()", () => {
  it("computes basis points exactly", () => {
    expect(previewFeeMinor(2500n, 500)).toBe(125n);
    expect(previewFeeMinor(100000n, 1500)).toBe(15000n);
  });

  it("rounds half up at the boundary", () => {
    // 15 * 1000 / 10000 = 1.5 -> 2 (plain floor would give 1)
    expect(previewFeeMinor(15n, 1000)).toBe(2n);
    // 3 * 5000 / 10000 = 1.5 -> 2
    expect(previewFeeMinor(3n, 5000)).toBe(2n);
    // 14 * 1000 / 10000 = 1.4 -> 1 (below the halfway point stays down)
    expect(previewFeeMinor(14n, 1000)).toBe(1n);
  });

  it("applies the minimum fee when it exceeds the percentage", () => {
    expect(previewFeeMinor(1000n, 100, 250n)).toBe(250n);
    expect(previewFeeMinor(1000n, 5000)).toBe(500n);
  });

  it("never lets the fee exceed the gross amount", () => {
    expect(previewFeeMinor(100n, 20000)).toBe(100n);
    expect(previewFeeMinor(100n, 0, 500n)).toBe(100n);
    expect(previewFeeMinor(0n, 500)).toBe(0n);
  });
});

describe("feePercentLabel()", () => {
  it("labels whole basis-point rates without float division", () => {
    expect(feePercentLabel(500)).toBe("5%");
    expect(feePercentLabel(0)).toBe("0%");
    expect(feePercentLabel(2500)).toBe("25%");
  });

  it("keeps fractional rates exact and trailing-zero free", () => {
    expect(feePercentLabel(1250)).toBe("12.5%");
    expect(feePercentLabel(333)).toBe("3.33%");
    expect(feePercentLabel(1050)).toBe("10.5%");
  });
});
