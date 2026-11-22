import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { makeListingOfferAction, requestServiceHireAction, respondListingOfferAction, respondServiceHireAction, setListingPickupAction } from "./marketplace-deals";
import { notifyListingChatRecipient } from "@/server/email/notify";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/email/notify", () => ({ notifyListingChatRecipient: vi.fn() }));

const listingId = "123e4567-e89b-42d3-a456-426614174000";
const conversationId = "123e4567-e89b-42d3-a456-426614174001";
const offerId = "123e4567-e89b-42d3-a456-426614174002";
const hireId = "123e4567-e89b-42d3-a456-426614174003";
let signedIn = true;
let rpcError: string | null = null;
const rpc = vi.fn();

beforeEach(() => {
  signedIn = true;
  rpcError = null;
  rpc.mockReset();
  vi.mocked(notifyListingChatRecipient).mockReset();
  vi.mocked(notifyListingChatRecipient).mockResolvedValue(undefined);
  rpc.mockImplementation(async (name: string) => ({
    data: name === "make_listing_offer" ? offerId : name === "request_service_hire" ? hireId : "PENDING",
    error: rpcError ? { message: rpcError } : null,
  }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: "seller" } : null } })) },
    rpc,
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: table === "listing_offers"
            ? { conversation_id: conversationId, seller_id: "seller", buyer_id: "buyer", listing_id: listingId }
            : { conversation_id: conversationId, provider_id: "seller", client_id: "buyer", listing_id: listingId }, error: null }),
          maybeSingle: async () => ({ data: table === "auctions"
            ? { title: "Gaming laptop" }
            : table === "listing_offers"
              ? { conversation_id: conversationId, seller_id: "seller", buyer_id: "buyer", listing_id: listingId }
              : { conversation_id: conversationId, provider_id: "seller", client_id: "buyer", listing_id: listingId }, error: null }),
        }),
      }),
    })),
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

describe("Sale offers and Service requests", () => {
  it("validates and sends a selected Sale offer with no payment information", async () => {
    expect((await makeListingOfferAction({ listingId, amountMinor: 0 })).ok).toBe(false);
    const response = await makeListingOfferAction({ listingId, amountMinor: 14400 });
    expect(response).toEqual({ ok: true, conversationId });
    expect(rpc).toHaveBeenCalledWith("make_listing_offer", {
      p_listing_id: listingId, p_amount_minor: 14400,
    });
    expect(notifyListingChatRecipient).toHaveBeenCalledWith("seller", "Gaming laptop", conversationId);
  });

  it("sends Service enquiries through the existing hire-request RPC", async () => {
    const details = "Repair my laptop screen. Preferred date: 2026-12-04.";
    const response = await requestServiceHireAction({ listingId, details });
    expect(response).toEqual({ ok: true, conversationId });
    expect(rpc).toHaveBeenCalledWith("request_service_hire", {
      p_listing_id: listingId, p_details: details,
    });
    expect(notifyListingChatRecipient).toHaveBeenCalledWith("seller", "Gaming laptop", conversationId);
  });

  it("notifies the buyer after Sale acceptance and Service acceptance", async () => {
    await respondListingOfferAction({ offerId, accept: true });
    await respondServiceHireAction({ requestId: hireId, action: "ACCEPT" });
    expect(notifyListingChatRecipient).toHaveBeenCalledTimes(2);
    expect(notifyListingChatRecipient).toHaveBeenCalledWith("buyer", "Gaming laptop", conversationId);
  });

  it("never accepts invalid or unsigned deal submissions", async () => {
    expect((await requestServiceHireAction({ listingId, details: "too short" })).ok).toBe(false);
    expect((await makeListingOfferAction({ listingId, amountMinor: 1 })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    signedIn = false;
    expect((await makeListingOfferAction({ listingId, amountMinor: 16000 })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
