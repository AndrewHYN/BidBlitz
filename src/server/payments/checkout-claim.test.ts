import { beforeEach, expect, it, vi } from "vitest";
import { claimCheckout } from "./checkout-claim";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
beforeEach(() => rpc.mockReset());

it.each(["claimed", "resume", "held"])("preserves the authoritative %s result", async (state) => {
  rpc.mockResolvedValue({ data: state, error: null });
  expect(await claimCheckout("transaction", "buyer", "linkwa")).toBe(state);
  expect(rpc).toHaveBeenCalledWith("claim_payment_checkout", {
    p_transaction_id: "transaction", p_buyer_id: "buyer", p_provider: "linkwa",
  });
});

it.each(["payment_window_expired", "not_awaiting_payment", "existing_provider_payment_pending"])(
  "preserves the %s rejection without exposing database details", async (reason) => {
    rpc.mockResolvedValue({ data: null, error: { message: reason } });
    await expect(claimCheckout("transaction", "buyer", "linkwa")).rejects.toMatchObject({ reason });
  }
);

it.each([null, "unknown", {}, true])("fails closed for an invalid RPC reply", async (data) => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(claimCheckout("transaction", "buyer", "linkwa")).rejects.toMatchObject({ code: "PAYMENT_LEDGER_UNAVAILABLE" });
});

it("keeps infrastructure errors out of the public rejection", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE DATABASE ERROR" } });
  await expect(claimCheckout("transaction", "buyer", "linkwa")).rejects.toThrow("Checkout reservation could not be verified.");
});
