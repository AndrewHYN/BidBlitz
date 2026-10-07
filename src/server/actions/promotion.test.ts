import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";
import { decidePromotionAction, requestPromotionAction } from "./promotion";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/permissions", () => ({ requirePermission: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const USER_ID = "00000000-0000-0000-0000-000000000001";
const AUCTION_ID = "00000000-0000-0000-0000-000000000002";
const REQUEST_ID = "00000000-0000-0000-0000-000000000003";

function clientWithRpc(
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    rpc,
  };
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(requirePermission).mockReset();
});

describe("requestPromotionAction", () => {
  it("sends a seller's 3-day request only through the promotion RPC", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    vi.mocked(createClient).mockResolvedValue(
      clientWithRpc(async (name, args) => {
        calls.push({ name, args });
        return { data: { status: "PENDING" }, error: null };
      }) as never
    );

    const result = await requestPromotionAction({ auctionId: AUCTION_ID, days: 3 });

    expect(result).toEqual({ ok: true, status: "PENDING" });
    expect(calls).toEqual([
      {
        name: "request_auction_promotion",
        args: { p_auction_id: AUCTION_ID, p_days: 3 },
      },
    ]);
  });

  it("rejects unsupported durations before touching Supabase", async () => {
    const result = await requestPromotionAction({ auctionId: AUCTION_ID, days: 30 });
    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("requires a signed-in seller", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never);

    const result = await requestPromotionAction({ auctionId: AUCTION_ID, days: 7 });
    expect(result).toEqual({ ok: false, message: "Sign in first." });
  });
});

describe("decidePromotionAction", () => {
  it("requires marketplace-management permission before calling the admin RPC", async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      ok: false,
      message: "Admins only.",
    });

    const result = await decidePromotionAction({
      requestId: REQUEST_ID,
      approve: true,
    });

    expect(result).toEqual({ ok: false, message: "Admins only." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("approves through the dedicated admin RPC after permission succeeds", async () => {
    vi.mocked(requirePermission).mockResolvedValue({ ok: true, userId: USER_ID });
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    vi.mocked(createClient).mockResolvedValue(
      clientWithRpc(async (name, args) => {
        calls.push({ name, args });
        return { data: { status: "APPROVED" }, error: null };
      }) as never
    );

    const result = await decidePromotionAction({
      requestId: REQUEST_ID,
      approve: true,
      note: "Placement confirmed",
    });

    expect(result).toEqual({ ok: true, status: "APPROVED" });
    expect(calls).toEqual([
      {
        name: "admin_decide_promotion",
        args: {
          p_request_id: REQUEST_ID,
          p_approve: true,
          p_note: "Placement confirmed",
        },
      },
    ]);
  });
});
