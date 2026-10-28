import { describe, expect, it } from "vitest";
import { parseCollectionChecks, parseSalesAccount } from "./sales-account";

const id = "f06b0fc3-70e9-462a-a23d-38c57472e51e";
const base = {
  currency: "USD", asOf: "2026-10-28T05:00:00Z", transactionCount: 1, otherCurrencyCount: 0,
  grossMinor: "120", feeMinor: "6", proceedsMinor: "114", unverifiedMinor: "114",
  heldMinor: "0", readyMinor: "0", reviewMinor: "0", paidOutMinor: "0",
  entries: [{ id, auctionId: "afce8af9-aa0a-424b-a10f-b7c0e703d358", title: "Paid sale",
    grossMinor: "120", feeMinor: "6", proceedsMinor: "114", createdAt: "2026-10-09T00:00:00Z",
    providerReference: "COLLECTION-1", collectionVerified: false, bucket: "UNVERIFIED" }],
};
describe("sales account financial boundary", () => {
  it("preserves exact gross, fee and seller proceeds", () => {
    expect(parseSalesAccount(base)?.proceedsMinor).toBe("114");
  });
  it("keeps integers beyond JavaScript's safe number limit exact", () => {
    const value = structuredClone(base);
    value.grossMinor = "10000000000000000001";
    value.feeMinor = "500000000000000000";
    value.proceedsMinor = value.unverifiedMinor = "9500000000000000001";
    value.entries = [];
    expect(parseSalesAccount(value)?.proceedsMinor).toBe(value.proceedsMinor);
  });
  it.each(["-1", "1.14", "1e2", "NaN"])("refuses invalid monetary units %s", (amount) => {
    expect(parseSalesAccount({ ...base, proceedsMinor: amount })).toBeNull();
  });
  it("rejects inconsistent fee math and totals", () => {
    expect(parseSalesAccount({ ...base, grossMinor: "121" })).toBeNull();
    expect(parseSalesAccount({ ...base, heldMinor: "114" })).toBeNull();
  });
  it("never accepts ready funds without merchant evidence", () => {
    const value = structuredClone(base);
    value.entries[0].bucket = "READY";
    value.unverifiedMinor = "0";
    value.readyMinor = "114";
    expect(parseSalesAccount(value)).toBeNull();
  });
  it("rejects a duplicated sale or incomplete response", () => {
    expect(parseSalesAccount({ ...base, transactionCount: 2, entries: [base.entries[0], base.entries[0]] })).toBeNull();
    expect(parseSalesAccount({ currency: "USD" })).toBeNull();
  });
  it("supports totals covering more than the displayed page", () => {
    expect(parseSalesAccount({ ...base, transactionCount: 101, entries: [] })).not.toBeNull();
  });
  it("requires every requested finance check once", () => {
    const check = { transactionId: id, verified: false, nonLive: false, settlementReference: null, verifiedAt: null };
    expect(parseCollectionChecks([check], [id])).toEqual([check]);
    expect(parseCollectionChecks([], [id])).toBeNull();
    expect(parseCollectionChecks([check, check], [id])).toBeNull();
  });
  it("refuses invented proof and contradictory test classifications", () => {
    const check = { transactionId: id, verified: true, nonLive: false, settlementReference: null, verifiedAt: null };
    expect(parseCollectionChecks([check], [id])).toBeNull();
    expect(parseCollectionChecks([{ ...check, nonLive: true, settlementReference: "R123456", verifiedAt: "2026-10-28" }], [id])).toBeNull();
  });
});
