import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { releaseSellerPayout } from "@/server/payments/seller-payout";
import { confirmDeliveryAction } from "./delivery";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/payments/seller-payout", () => ({ releaseSellerPayout: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const USER_ID = "3f1d2a4c-9b7e-4f0a-8c2d-1e6b5a4f3c2d";
const TX_ID = "4a2c1e7d-8b6f-4d3a-9c1e-2f7b5a6d4c3e";
const PAYOUT_ID = "5b3d2f8e-7c6a-4e1b-8d2f-3a6c5b7e4d2f";

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(releaseSellerPayout).mockReset();
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    rpc: vi.fn(async () => ({
      data: { ok: true, payout_id: PAYOUT_ID, status: "DELIVERY_CONFIRMED" },
      error: null,
    })),
  } as never);
});

describe("confirmDeliveryAction", () => {
  it("confirms in the database before releasing the frozen seller payout", async () => {
    vi.mocked(releaseSellerPayout).mockResolvedValue({
      ok: true,
      status: "PAID_OUT",
      payoutReference: "payout-1",
    });

    const result = await confirmDeliveryAction({ transactionId: TX_ID });

    expect(result).toEqual({
      ok: true,
      payoutReleased: true,
      message: "Handover confirmed. The seller payout was sent through Linkwa.",
    });
    expect(releaseSellerPayout).toHaveBeenCalledWith(PAYOUT_ID);
  });

  it("records handover even while money movement is paused", async () => {
    vi.mocked(releaseSellerPayout).mockResolvedValue({
      ok: false,
      code: "payments_paused",
      message: "Payments paused",
    });

    const result = await confirmDeliveryAction({ transactionId: TX_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payoutReleased).toBe(false);
    expect(result.message).toMatch(/queued until payments resume/i);
  });

  it("never calls the payout service when the database refuses buyer confirmation", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
      rpc: vi.fn(async () => ({ data: null, error: { message: "buyer_only" } })),
    } as never);

    const result = await confirmDeliveryAction({ transactionId: TX_ID });

    expect(result).toEqual({ ok: false, message: "Only the buyer can confirm handover." });
    expect(releaseSellerPayout).not.toHaveBeenCalled();
  });
});
