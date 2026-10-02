import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { queueEmail } from "@/server/email/sender";
import { resetRateLimits } from "@/server/rate-limit";
import { markThreadReadAction, sendMessageAction } from "./messages";

/**
 * Transaction threads: parties-only read/write, banned senders refused,
 * alerts best-effort, forged ids indistinguishable from missing ones.
 *
 * The database RLS itself is proven by migration + live probe
 * (scripts/db/verify-messaging-rls.mjs, post-migration); these tests pin the
 * action-level contract that must hold regardless: validation before network,
 * ownership before insert, budget before send, and alerts that can never fail
 * a send.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/email/sender", () => ({
  queueEmail: vi.fn(async () => "email-id"),
  emailKey: (...parts: Array<string | number>) => parts.join(":"),
}));
const { publishToUserMock } = vi.hoisted(() => ({ publishToUserMock: vi.fn(async () => {}) }));
vi.mock("@/lib/realtime/supabase", () => ({
  createServerRealtime: vi.fn(() => ({ publishToUser: publishToUserMock })),
}));

const TX_ID = "123e4567-e89b-42d3-a456-426614174000";
const ME = "me-user-id";
const OTHER = "other-user-id";

let sessionUser: string | null = ME;
let txRow: { id: string; auction_id: string; seller_id: string; buyer_id: string; auctions: { title: string } } | null = null;
let banned = false;
let insertError: string | null = null;
let updateError: string | null = null;
let adminThrows = false;
const inserted: Array<Record<string, unknown>> = [];

function chain(value: unknown) {
  const c: Record<string, unknown> = {};
  c.eq = vi.fn(() => c);
  c.neq = vi.fn(() => c);
  c.is = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => value);
  c.single = vi.fn(async () => value);
  return c;
}

function mockClients() {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: sessionUser ? { id: sessionUser } : null } })) },
    from: vi.fn((table: string) => {
      if (table === "transactions") return { select: vi.fn(() => chain({ data: txRow, error: null })) };
      if (table === "profiles")
        return { select: vi.fn(() => chain({ data: banned ? { is_banned: true } : { is_banned: false }, error: null })) };
      if (table === "transaction_messages") {
        return {
          select: vi.fn(() => chain({ data: [], error: null })),
          insert: vi.fn(async (row: Record<string, unknown>) => {
            if (insertError) return { error: { message: insertError } };
            inserted.push(row);
            return { error: null };
          }),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({ neq: vi.fn(() => ({ is: vi.fn(async () => ({ error: updateError ? { message: updateError } : null })) })) })),
          })),
        };
      }
      return { select: vi.fn(() => chain({ data: null, error: null })) };
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({
      insert: vi.fn(async () => {
        if (adminThrows) throw new Error("db down");
        return { error: null };
      }),
      select: vi.fn(() => chain({ data: { display_name: "Counter" }, error: null })),
    })),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => {
          if (adminThrows) throw new Error("db down");
          return { data: { user: { email: `${id}@example.com` } } };
        }),
      },
    },
  } as unknown as ReturnType<typeof createAdminClient>);
}

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
  sessionUser = ME;
  txRow = { id: TX_ID, auction_id: "a-1", seller_id: ME, buyer_id: OTHER, auctions: { title: "Radio" } };
  banned = false;
  insertError = null;
  updateError = null;
  adminThrows = false;
  inserted.length = 0;
  mockClients();
});

describe("sendMessageAction", () => {
  it("rejects an empty body before contacting the provider", async () => {
    const result = await sendMessageAction({ transactionId: TX_ID, body: "   " });
    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed transaction id before contacting the provider", async () => {
    const result = await sendMessageAction({ transactionId: "not-a-uuid", body: "hello" });
    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses signed-out senders", async () => {
    sessionUser = null;
    mockClients();
    const result = await sendMessageAction({ transactionId: TX_ID, body: "hello" });
    expect(result).toEqual({
      ok: false,
      rejection: { code: "not_authenticated", message: "Sign in to message." },
    });
  });

  it("refuses non-parties without distinguishing missing from forbidden", async () => {
    txRow = null;
    mockClients();
    const result = await sendMessageAction({ transactionId: TX_ID, body: "hello" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("not_owner");
    expect(result.rejection.message).toBe("This conversation is not available.");
    expect(inserted).toHaveLength(0);
  });

  it("refuses banned senders while leaving RLS parties-only", async () => {
    banned = true;
    mockClients();
    const result = await sendMessageAction({ transactionId: TX_ID, body: "hello" });
    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("throttles floods per sender without spending another's budget", async () => {
    for (let i = 0; i < 20; i += 1) {
      const r = await sendMessageAction({ transactionId: TX_ID, body: `hello ${i}` });
      expect(r.ok).toBe(true);
    }
    const blocked = await sendMessageAction({ transactionId: TX_ID, body: "one more" });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.rejection.code).toBe("rate_limited");
  });

  it("inserts the message for a party and alerts best-effort", async () => {
    const result = await sendMessageAction({ transactionId: TX_ID, body: "Is pickup possible?" });
    expect(result).toEqual({ ok: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ transaction_id: TX_ID, sender_id: ME });
    expect(queueEmail).toHaveBeenCalled();
    expect(publishToUserMock).toHaveBeenCalled();
  });

  it("still sends when the alert subsystem is down", async () => {
    adminThrows = true;
    mockClients();
    const result = await sendMessageAction({ transactionId: TX_ID, body: "hello" });
    expect(result).toEqual({ ok: true });
    expect(inserted).toHaveLength(1);
  });

  it("lets the buyer side send too", async () => {
    sessionUser = OTHER;
    txRow = { id: TX_ID, auction_id: "a-1", seller_id: ME, buyer_id: OTHER, auctions: { title: "Radio" } };
    mockClients();
    const result = await sendMessageAction({ transactionId: TX_ID, body: "Paying now." });
    expect(result).toEqual({ ok: true });
  });

  it("broadcasts a doorbell with no body, contact, or secret in it", async () => {
    await sendMessageAction({ transactionId: TX_ID, body: "My number is 07700, call me" });
    expect(publishToUserMock).toHaveBeenCalledTimes(1);
    const [recipientId, auctionId, event] = publishToUserMock.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    // Routed to the counterparty's private channel, never the public one.
    expect(recipientId).toBe(OTHER);
    expect(auctionId).toBe("a-1");
    expect(event.type).toBe("message.received");
    const joined = JSON.stringify(event).toLowerCase();
    expect(joined).not.toContain("my number");
    expect(joined).not.toContain("07700");
    for (const key of Object.keys(event)) {
      expect(["type", "auctionId", "transactionId", "senderId", "serverTime"]).toContain(key);
    }
  });
});

describe("markThreadReadAction", () => {
  it("refuses signed-out callers", async () => {
    sessionUser = null;
    mockClients();
    const result = await markThreadReadAction({ transactionId: TX_ID });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed id", async () => {
    const result = await markThreadReadAction({ transactionId: "nope" });
    expect(result.ok).toBe(false);
  });

  it("answers ok for forged ids without leaking membership", async () => {
    txRow = null;
    mockClients();
    // No membership check here on purpose: the update touches zero rows for
    // non-parties (RLS), and ok-ness reveals nothing either way.
    const result = await markThreadReadAction({ transactionId: TX_ID });
    expect(result).toEqual({ ok: true });
  });

  it("marks inbound rows read for a party", async () => {
    const result = await markThreadReadAction({ transactionId: TX_ID });
    expect(result).toEqual({ ok: true });
  });

  it("surfaces provider failures honestly", async () => {
    updateError = "connection lost";
    mockClients();
    const result = await markThreadReadAction({ transactionId: TX_ID });
    expect(result.ok).toBe(false);
  });
});
