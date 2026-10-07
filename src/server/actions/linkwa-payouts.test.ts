import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { releaseSellerPayout } from "@/server/payments/seller-payout";
import { initiateLinkwaPayoutAction } from "./linkwa-payouts";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/payments/seller-payout", () => ({ releaseSellerPayout: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const PAYOUT_ID = "11111111-1111-4111-8111-111111111111";

function mockSession(userId: string | null, isAdmin: boolean) {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId } : null },
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { is_admin: isAdmin }, error: null })),
        })),
      })),
    })),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession("admin-user", true);
  vi.mocked(releaseSellerPayout).mockResolvedValue({
    ok: true,
    status: "PAID_OUT",
    payoutReference: "linkwa-payout-1",
  });
});

describe("initiateLinkwaPayoutAction", () => {
  it("validates the payout id before touching the session", async () => {
    const result = await initiateLinkwaPayoutAction({ payoutId: "bad" });
    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(releaseSellerPayout).not.toHaveBeenCalled();
  });

  it("requires an authenticated administrator", async () => {
    mockSession(null, false);
    expect(await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID })).toEqual({
      ok: false,
      message: "Sign in.",
    });

    mockSession("user-1", false);
    expect(await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID })).toEqual({
      ok: false,
      message: "Admins only.",
    });
    expect(releaseSellerPayout).not.toHaveBeenCalled();
  });

  it("delegates to the single payout engine instead of instructing Linkwa itself", async () => {
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });

    expect(releaseSellerPayout).toHaveBeenCalledTimes(1);
    expect(releaseSellerPayout).toHaveBeenCalledWith(PAYOUT_ID);
    expect(result).toEqual({ ok: true, payoutReference: "linkwa-payout-1" });
  });

  it("surfaces payout-engine refusal without a second money path", async () => {
    vi.mocked(releaseSellerPayout).mockResolvedValue({
      ok: false,
      code: "provider_funds_pending",
      message: "Linkwa settlement balance is still pending.",
    });

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({
      ok: false,
      message: "Linkwa settlement balance is still pending.",
    });
    expect(releaseSellerPayout).toHaveBeenCalledTimes(1);
  });
});
