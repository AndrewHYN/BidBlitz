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
