import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const conversation = "4459015a-2c71-4a06-bc1f-9bf409fd1bb6";
const key = "da483e82-0091-4413-9a63-a7ea16b54ae0";
const sender = "test-seller";
const uploaded = vi.fn();
const rpc = vi.fn();
const afterResponse = vi.fn();
const sent = new Map<string, Record<string, string>>();
let member = true;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterResponse(fn) }));
vi.mock("@/server/email/notify", () => ({ notifyListingChatRecipient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, storage: { from: () => ({ upload: uploaded }) } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: sender } } }) },
    from(table: string) {
      const filters: Record<string, string> = {};
      return {
        select() { return this; },
        eq(column: string, value: string) { filters[column] = value; return this; },
        async maybeSingle() {
          if (table === "listing_conversations") return { data: member ? { buyer_id: "buyer", seller_id: sender } : null };
          const row = sent.get(filters.id);
          return { data: row && Object.entries(filters).every(([k, v]) => row[k] === v) ? row : null };
        },
      };
    },
  }),
}));

function send(idempotencyKey?: string) {
  const headers = new Headers({ origin: "https://chat.test", host: "chat.test", "content-type": "image/jpeg" });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return POST(new Request(`https://chat.test/api/messages/${conversation}/media`, {
    method: "POST", headers, body: new Uint8Array([255, 216, 255, 217]),
  }), { params: Promise.resolve({ id: conversation }) });
}

describe("chat photo upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sent.clear();
    member = true;
    uploaded.mockResolvedValue({ error: null });
    rpc.mockImplementation(async (name, args) => {
      if (name === "send_listing_chat_attachment") {
        sent.set(args.p_message_id, { id: args.p_message_id, sender_id: args.p_sender_id,
          conversation_id: args.p_conversation_id, attachment_kind: args.p_kind });
      }
      return { error: null };
    });
  });

  it("acknowledges a retry after a lost response without a second file, message or notification", async () => {
    expect(await (await send(key)).json()).toEqual({ ok: true });
    expect(await (await send(key)).json()).toEqual({ ok: true });
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(sent.size).toBe(1);
    expect(afterResponse).toHaveBeenCalledTimes(1);
  });

  it("checks conversation membership even for a previously completed upload", async () => {
    await send(key);
    member = false;
    expect((await send(key)).status).toBe(404);
    expect(uploaded).toHaveBeenCalledTimes(1);
  });

  it("accepts older clients and rejects malformed retry keys", async () => {
    expect((await send("invalid")).status).toBe(400);
    expect((await send()).status).toBe(200);
    expect(uploaded).toHaveBeenCalledTimes(1);
  });
});
