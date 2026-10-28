import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";
import { recordMerchantCollectionAction } from "./collection-evidence";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/permissions", () => ({ requirePermission: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
const request = {
  transactionId: "f06b0fc3-70e9-462a-a23d-38c57472e51e", collectionReference: "COLLECTION-EXAMPLE-123",
  receivedAmount: "1.20", currency: "USD", settlementReference: "WALLET-RECEIPT-123",
  source: "MERCHANT_WALLET_RECEIPT", note: "Matched the settled wallet receipt to this exact sale.", fundsReceived: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({ ok: true, userId: request.transactionId });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  rpc.mockResolvedValue({ data: { ok: true, already: false }, error: null });
});
describe("merchant receipt action", () => {
  it("requires live finance authorization before database mutation", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: false, message: "Admins only." });
    expect(await recordMerchantCollectionAction(request)).toEqual({ ok: false, message: "Admins only." });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { fundsReceived: false }, { currency: "ZAR" }, { receivedAmount: "1.201" },
    { receivedAmount: "0" }, { receivedAmount: "92233720368547758.08" }, { note: "Too short" },
    { source: "BUYER_SCREENSHOT" },
  ])("rejects incomplete or invalid receipt input %j", async (override) => {
    expect(await recordMerchantCollectionAction({ ...request, ...override })).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes exact integer minor units and confirms no payout", async () => {
    expect(await recordMerchantCollectionAction(request)).toEqual({ ok: true, already: false });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("record_merchant_collection", expect.objectContaining({ p_gross_minor: "120", p_currency: "USD", p_funds_received: true }));
    expect(requirePermission).toHaveBeenCalledWith("payouts.mark_paid");
  });
  it("keeps large valid amounts exact", async () => {
    await recordMerchantCollectionAction({ ...request, receivedAmount: "90071992547409.93" });
    expect(rpc).toHaveBeenCalledWith("record_merchant_collection", expect.objectContaining({ p_gross_minor: "9007199254740993" }));
  });
  it("reports an already-recorded receipt without another operation", async () => {
    rpc.mockResolvedValue({ data: { ok: true, already: true }, error: null });
    expect(await recordMerchantCollectionAction(request)).toEqual({ ok: true, already: true });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("surfaces exact-sale mismatches", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "collection_does_not_match_sale" } });
    expect(await recordMerchantCollectionAction(request)).toMatchObject({ ok: false, message: expect.stringContaining("does not match") });
  });
  it("never treats an unknown response as proof or a zero balance", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await recordMerchantCollectionAction(request)).toMatchObject({ ok: false, message: expect.stringContaining("could not be confirmed") });
  });
  it("does not disclose raw database error details", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private table details and infrastructure failure" } });
    const result = await recordMerchantCollectionAction(request);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("private table");
  });
});
