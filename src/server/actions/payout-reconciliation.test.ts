import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";
import { recordPayoutReconciliationAction } from "./payout-reconciliation";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/permissions", () => ({ requirePermission: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const PAYOUT = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof requirePermission>>);
  vi.mocked(createClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createClient>>);
  rpc.mockResolvedValue({ data: { ok: true, status: "RECORDED" }, error: null });
});

describe("payout reconciliation action", () => {
  it("rejects unverified seller receipts without calling a database write", async () => {
    const result = await recordPayoutReconciliationAction({
      payoutId: PAYOUT, kind: "SELLER_RECEIPT", reference: "actual-reference",
      note: "Provider replied, but the seller has not yet confirmed receipt.",
      sellerReceiptVerified: false,
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a real reference for provider and wallet-receipt evidence", async () => {
    const result = await recordPayoutReconciliationAction({
      payoutId: PAYOUT, kind: "PROVIDER_REFERENCE", reference: "",
      note: "Investigating the provider's previously returned transaction ID.",
      sellerReceiptVerified: false,
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses evidence recording when permissions are absent", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      ok: false, message: "Not authorized",
    } as Awaited<ReturnType<typeof requirePermission>>);
    const result = await recordPayoutReconciliationAction({
      payoutId: PAYOUT, kind: "INVESTIGATION", reference: "",
      note: "The provider has not yet confirmed any settlement status.",
      sellerReceiptVerified: false,
    });
    expect(result).toEqual({ ok: false, message: "Not authorized" });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records investigation evidence but never instructs a transfer", async () => {
    const input = {
      payoutId: PAYOUT, kind: "INVESTIGATION", reference: "",
      note: "Asked the provider to search for the original attempted payout.",
      sellerReceiptVerified: false,
    } as const;
    expect(await recordPayoutReconciliationAction(input)).toEqual({ ok: true, status: "RECORDED" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("staff_record_payout_reconciliation", {
      p_payout_id: PAYOUT, p_kind: "INVESTIGATION", p_reference: null,
      p_note: input.note, p_seller_receipt_verified: false,
    });
  });

  it("does not claim success if the database refused the audit", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private provider error" } });
    const result = await recordPayoutReconciliationAction({
      payoutId: PAYOUT, kind: "SELLER_RECEIPT", reference: "provider-reference-1",
      note: "Verified original wallet receipt independently with both parties.",
      sellerReceiptVerified: true,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private provider error");
  });
});
