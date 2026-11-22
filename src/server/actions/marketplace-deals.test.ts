import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { setListingPickupAction } from "./marketplace-deals";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const listingId = "123e4567-e89b-42d3-a456-426614174000";
const conversationId = "123e4567-e89b-42d3-a456-426614174001";
let signedIn = true;
let rpcError: string | null = null;
const rpc = vi.fn();

beforeEach(() => {
  signedIn = true;
  rpcError = null;
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ data: "PENDING", error: rpcError ? { message: rpcError } : null }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: "seller" } : null } })) },
    rpc,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});

describe("listing pickup action", () => {
  it("rejects malformed IDs without touching the database", async () => {
    expect((await setListingPickupAction({ listingId, conversationId: "bad" })).ok).toBe(false);
    expect((await setListingPickupAction({ listingId, conversationId, buyerId: "forged" })).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_listing_pickup", {
      p_listing_id: listingId, p_conversation_id: conversationId,
    });
  });

  it("requires authentication and does not send the request when signed out", async () => {
    signedIn = false;
    expect((await setListingPickupAction({ listingId, conversationId })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows a reversible release and preserves server-enforced ownership", async () => {
    const response = await setListingPickupAction({ listingId, conversationId: null });
    expect(response).toEqual({ ok: true, status: "PENDING" });
    expect(rpc).toHaveBeenCalledWith("set_listing_pickup", {
      p_listing_id: listingId, p_conversation_id: null,
    });
  });

  it("explains an existing reservation instead of silently switching buyers", async () => {
    rpcError = "already_reserved";
    const response = await setListingPickupAction({ listingId, conversationId });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.message).toMatch(/another buyer/i);
  });
});
