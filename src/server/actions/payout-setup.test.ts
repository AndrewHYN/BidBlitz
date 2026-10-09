import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readLinkwaEnvironment } from "@/server/payments/config";
import { linkLinkwaUser, registerLinkwaWallet } from "@/server/payments/linkwa-payouts";
import { setupSellerPayoutAction } from "./payout-setup";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/server/payments/config", () => ({ readLinkwaEnvironment: vi.fn() }));
vi.mock("@/server/payments/linkwa-payouts", () => ({ linkLinkwaUser: vi.fn(), registerLinkwaWallet: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => { vi.clearAllMocks(); });

it("never creates a provider user or wallet when payout details cannot be saved", async () => {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "seller-1", email: "seller@example.test" } } })) },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(readLinkwaEnvironment).mockReturnValue({
    state: "ready", missing: [],
    config: { apiKey: "test-key", baseUrl: "https://linkwa.co.zw", webhookSecret: "test-secret" },
  });
  const upsert = vi.fn(async () => ({ error: { message: "constraint violation" } }));
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({ upsert })),
  } as unknown as ReturnType<typeof createAdminClient>);
  const result = await setupSellerPayoutAction({ firstName: "Test", lastName: "Seller", phone: "0771234567" });
  expect(result.ok).toBe(false);
  expect(upsert).toHaveBeenCalledTimes(1);
  expect(linkLinkwaUser).not.toHaveBeenCalled();
  expect(registerLinkwaWallet).not.toHaveBeenCalled();
});

function successfulStorage() {
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "seller-1", email: "seller@example.test" } } }) } } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(readLinkwaEnvironment).mockReturnValue({ state: "ready", missing: [], config: { apiKey: "test-key", baseUrl: "https://linkwa.co.zw", webhookSecret: "test-secret" } });
  const upsert = vi.fn(async (row: unknown) => { void row; return { error: null }; });
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => ({ upsert })) } as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(linkLinkwaUser).mockResolvedValue({ externalUserId: "linked-user", firstName: "Test", lastName: "Seller", phoneNumber: "+263771234567" });
  return upsert;
}
it("saves a linked recipient before wallet registration and marks READY only with both provider IDs", async () => {
  const upsert = successfulStorage();
  vi.mocked(registerLinkwaWallet).mockResolvedValue({ externalWalletId: "wallet", provider: "smilecash" });
  expect((await setupSellerPayoutAction({ firstName: "Test", lastName: "Seller", phone: "0771234567" })).ok).toBe(true);
  expect(upsert.mock.calls[1]?.[0]).toMatchObject({ external_user_id: "linked-user", setup_status: "LINKING" });
  expect(upsert.mock.calls[2]?.[0]).toMatchObject({ external_user_id: "linked-user", external_wallet_id: "wallet", setup_status: "READY" });
});
it("preserves the successful recipient link when a wallet requires registration", async () => {
  const upsert = successfulStorage();
  const { PaymentPayloadError } = await import("@/server/payments/provider");
  vi.mocked(registerLinkwaWallet).mockRejectedValue(new PaymentPayloadError("wallet_registration_required", "private provider details"));
  expect(await setupSellerPayoutAction({ firstName: "Test", lastName: "Seller", phone: "0771234567" })).toMatchObject({ ok: false, status: "NEEDS_WALLET" });
  expect(upsert.mock.calls[2]?.[0]).toMatchObject({ setup_status: "NEEDS_WALLET" });
});
it("records the safe provider failure stage and refuses repeated seller retries for deployment authorization errors", async () => {
  const upsert = successfulStorage();
  const { PaymentProviderRequestError } = await import("@/server/payments/provider");
  vi.mocked(registerLinkwaWallet).mockRejectedValue(new PaymentProviderRequestError("private provider details", 403));
  const result = await setupSellerPayoutAction({ firstName: "Test", lastName: "Seller", phone: "0771234567" });
  expect(result).toMatchObject({ ok: false, message: expect.stringContaining("deployment’s payout access") });
  expect(upsert.mock.calls[2]?.[0]).toMatchObject({ setup_status: "ERROR", setup_error: "Linkwa wallet link failed (HTTP 403)" });
  expect(JSON.stringify(result)).not.toContain("private provider details");
});
