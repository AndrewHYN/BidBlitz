import { describe, expect, it } from "vitest";
import { parseFinanceOperations, safeMinor, payoutTriage, paymentEquation, statementReferenceFound } from "./operations";

const sample = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "PAYOUT_DUE", hasOpenDispute: false,
  deliveryConfirmedAt: "2026-10-08T12:00:00Z",
  paymentStatus: "PAID", walletReady: true,
} as const;

describe("finance operations safeguards", () => {
  it("fails closed on unavailable, partial or malformed finance RPC data", () => {
    expect(parseFinanceOperations(null)).toBeNull();
    expect(parseFinanceOperations({ transactions: [], payouts: [] })).toBeNull();
    expect(parseFinanceOperations({
      asOf: "2026-10-10", limit: 80, canViewPayments: true,
      canViewPayouts: true, transactions: [], payouts: [],
    })?.transactions).toEqual([]);
    expect(parseFinanceOperations({
      asOf: "2026-10-10", limit: 80, canViewPayments: true,
      canViewPayouts: true, transactions: [{ id: "fake" }], payouts: [],
    })).toBeNull();
  });

  it("never rounds unsafe money into a misleading display", () => {
    expect(safeMinor("95")).toBe(95);
    expect(safeMinor("9007199254740992")).toBeNull();
    expect(safeMinor("12.50")).toBeNull();
    expect(safeMinor("")).toBeNull();
    expect(safeMinor("-1")).toBe(-1);
  });

  it("payout under review is not paid, even with a provider reference", () => {
    expect(payoutTriage(sample)).toBe("reconcile");
    expect(payoutTriage({ ...sample, status: "PAYOUT_PENDING" })).toBe("ready");
    expect(payoutTriage({ ...sample, status: "PAYOUT_PENDING", walletReady: false })).toBe("waiting");
    expect(payoutTriage({ ...sample, status: "PAYOUT_PENDING", hasOpenDispute: true })).toBe("hold");
    expect(payoutTriage({ ...sample, status: "PAID_OUT" })).toBe("paid");
  });

  it("checks exact integer ledger equations", () => {
    expect(paymentEquation({ grossMinor: "120", feeMinor: "6", sellerMinor: "114" })).toBe(true);
    expect(paymentEquation({ grossMinor: "120", feeMinor: "6", sellerMinor: "115" })).toBe(false);
  });

  it("statement reference presence is only a hint for investigation", () => {
    expect(statementReferenceFound(null, [{ id: "ref" }])).toBe(false);
    expect(statementReferenceFound("ref", [{ id: "other" }])).toBe(false);
    expect(statementReferenceFound("ref", [{ id: "ref" }])).toBe(true);
  });
});
