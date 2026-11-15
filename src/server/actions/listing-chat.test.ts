import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import {
  startListingChatAction,
  sendListingChatAction,
  markListingChatReadAction,
} from "./listing-chat";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const LISTING = "123e4567-e89b-42d3-a456-426614174000";
const THREAD = "123e4567-e89b-42d3-a456-426614174001";
let signedIn = true;
let failure: string | null = null;
const rpcMock = vi.fn();

beforeEach(() => {
  signedIn = true;
  failure = null;
  rpcMock.mockReset();
  rpcMock.mockImplementation(async (name: string) => ({
    data: name === "start_listing_conversation" ? THREAD : name === "mark_listing_conversation_read" ? 1 : null,
    error: failure ? { message: failure } : null,
  }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? { id: "user1" } : null } })) },
    rpc: rpcMock,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});

describe("direct marketplace chat actions", () => {
  it("rejects empty and invalid requests before authentication or database access", async () => {
    expect((await startListingChatAction({ listingId: LISTING, body: "  " })).ok).toBe(false);
    expect((await startListingChatAction({ listingId: "invalid", body: "Hello" })).ok).toBe(false);
    expect((await sendListingChatAction({ conversationId: THREAD, body: "x".repeat(2001) })).ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    signedIn = false;
    const r = await startListingChatAction({ listingId: LISTING, body: "Is this available?" });
    expect(r.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("starts a conversation using the server-owned RPC and returns the thread", async () => {
    const result = await startListingChatAction({ listingId: LISTING, body: "Is this available?" });
    expect(result).toEqual({ ok: true, conversationId: THREAD });
    expect(rpcMock).toHaveBeenCalledWith("start_listing_conversation", {
      p_listing_id: LISTING, p_body: "Is this available?",
    });
  });

  it("sends a message by conversation id and never accepts forged sender fields", async () => {
    const result = await sendListingChatAction({ conversationId: THREAD, body: "Thanks!", senderId: "fake" });
    expect(result).toEqual({ ok: true, conversationId: THREAD });
    expect(rpcMock).toHaveBeenCalledWith("send_listing_message", {
      p_conversation_id: THREAD, p_body: "Thanks!",
    });
  });

  it("fails closed when the database denies access or rate limits", async () => {
    failure = "rate_limited";
    const result = await sendListingChatAction({ conversationId: THREAD, body: "Hello" });
    expect(result).toEqual({ ok: false, message: "Too many messages. Please try again later." });
    failure = "conversation_unavailable";
    const other = await sendListingChatAction({ conversationId: THREAD, body: "Hello" });
    expect(other.ok).toBe(false);
  });

  it("marks messages read through the authenticated RPC only", async () => {
    await markListingChatReadAction(THREAD);
    expect(rpcMock).toHaveBeenCalledWith("mark_listing_conversation_read", {
      p_conversation_id: THREAD,
    });
    rpcMock.mockClear();
    await markListingChatReadAction("not-a-uuid");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
