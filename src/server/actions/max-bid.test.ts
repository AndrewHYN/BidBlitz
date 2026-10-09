import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/server/rate-limit";
import { submitMaxBidAction, decideMaxBidAction } from "./max-bid";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => { throw new Error("broadcast offline"); }) }));
vi.mock("@/server/rate-limit", () => ({ BID_LIMIT: { limit: 5, windowMs: 1000 }, rateLimit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
function session(user: string | null) {
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) }, rpc } as unknown as Awaited<ReturnType<typeof createClient>>);
}
beforeEach(() => { vi.clearAllMocks(); session("buyer"); vi.mocked(rateLimit).mockReturnValue({ allowed: true, remaining: 4, retryAfterMs: 0 }); });
it("requires a binding bid confirmation before any database call", async () => {
  expect((await submitMaxBidAction({ auctionId: id, amountMinor: "1000", requestId: id, bindingBidConfirmed: false })).ok).toBe(false);
  expect(createClient).not.toHaveBeenCalled();
});
it("requires authentication and shares the ordinary bid rate limit", async () => {
  session(null);
  expect((await submitMaxBidAction({ auctionId: id, amountMinor: "1000", requestId: id, bindingBidConfirmed: true })).ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
  session("buyer"); vi.mocked(rateLimit).mockReturnValue({ allowed: false, remaining: 0, retryAfterMs: 1000 });
  expect((await submitMaxBidAction({ auctionId: id, amountMinor: "1000", requestId: id, bindingBidConfirmed: true })).ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});
it("passes integer minor units and preserves committed success when broadcast fails", async () => {
  rpc.mockResolvedValue({ data: { ok: true, amount_minor: 1000 }, error: null });
  expect(await submitMaxBidAction({ auctionId: id, amountMinor: "1000", requestId: id, bindingBidConfirmed: true })).toEqual({ ok: true });
  expect(rpc).toHaveBeenCalledWith("submit_max_bid", { p_auction_id: id, p_amount_minor: 1000, p_request_id: id });
});
it("refuses an outbid offer and never reports it as sold", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "offer_outbid" } });
  const result = await decideMaxBidAction({ offerId: id, accept: true, confirmed: true });
  expect(result).toEqual({ ok: false, message: "This Max Bid has been outbid. You can only accept the current highest bid." });
});
it("returns the authoritative transaction instead of initiating a payment", async () => {
  rpc.mockResolvedValue({ data: { ok: true, status: "SOLD", transaction_id: id, auction_id: id }, error: null });
  expect(await decideMaxBidAction({ offerId: id, accept: true, confirmed: true })).toEqual({ ok: true, transactionId: id });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("decide_max_bid", { p_offer_id: id, p_accept: true });
});
