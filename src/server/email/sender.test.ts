import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ rpc: mockRpc, from: mockFrom, auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [] } })) } } })),
  hasAdminCredentials: vi.fn(() => true),
}));

import { dispatchEmailOutbox, queueEmail } from "./sender";
import { createAdminClient } from "@/lib/supabase/admin";

function defaultClient() {
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(createAdminClient).mockImplementation(
    () =>
      ({
        rpc: mockRpc,
        from: mockFrom,
        auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } },
      }) as never
  );
}

/**
 * The sender's contract, with the provider behind a mock: without credentials
 * nothing is attempted and rows stay queued; a duplicate enqueue collapses;
 * a preference-disabled optional email is SKIPPED rather than sent; failures
 * are recorded, never thrown. Marketplace state is never in the blast radius
 * because queueEmail swallows everything into null.
 */

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    recipient: "buyer@example.com",
    template_key: "won",
    payload: { title: "Radio", auctionId: "a-1", amount: "$30.00", name: "Buyer" },
    idempotency_key: "won:auction:a-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe("queueEmail", () => {
  beforeEach(() => {
    defaultClient();
  });

  it("refuses unknown templates and bad addresses without touching the database", async () => {
    const insert = vi.fn();
    mockFrom.mockReturnValue({ insert });
    expect(await queueEmail({ to: "x", template: "nope", idempotencyKey: "k" })).toBeNull();
    expect(await queueEmail({ to: "not-an-email", template: "won", idempotencyKey: "k" })).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("dispatchEmailOutbox", () => {
  beforeEach(() => {
    defaultClient();
  });

  it("leaves rows queued and attempts nothing without Resend credentials", async () => {
    mockRpc.mockResolvedValue({ data: [job()], error: null });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const summary = await dispatchEmailOutbox(10);
    expect(summary).toEqual({ attempted: 0, sent: 0, skipped: 0, failed: 0, held: "no-resend-credentials" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends critical mail with the idempotency key and marks it sent", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockRpc.mockResolvedValue({ data: [job()], error: null });
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({})) }));
    mockFrom.mockReturnValue({ update });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "msg-1" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const summary = await dispatchEmailOutbox(10);
    expect(summary.sent).toBe(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("won:auction:a-1");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["buyer@example.com"]);
    expect(body.subject).toContain("Radio");
    expect(update).toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });

  it("immediately dispatches only the requested private message job, not the whole queue", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const target = job({
      id: "message-job",
      template_key: "listing_message",
      payload: { name: "Seller", title: "Laptop", conversationId: "thread-123", recipientId: "u-9" },
      idempotency_key: "listing_message:thread-123:seller:42",
    });
    const claim = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn(async () => ({ data: [target], error: null })),
    };
    const statusUpdate = { eq: vi.fn(async () => ({ error: null })) };
    const update = vi.fn((values: { status: string }) =>
      values.status === "SENDING" ? claim : statusUpdate
    );
    mockFrom.mockImplementation((table: string) => table === "notification_preferences"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { marketplace_activity: true } }) }) }) }
      : { update });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "resend-message-id" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const summary = await dispatchEmailOutbox(1, "message-job");

    expect(mockRpc).not.toHaveBeenCalled();
    expect(claim.eq).toHaveBeenCalledWith("id", "message-job");
    expect(claim.eq).toHaveBeenCalledWith("status", "QUEUED");
    expect(summary).toEqual({ attempted: 1, sent: 1, skipped: 0, failed: 0, held: null });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "SENT", provider_message_id: "resend-message-id" }));
    delete process.env.RESEND_API_KEY;
  });

  it("records a provider 401 on the specific message job without claiming a send", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const target = job({
      id: "message-job",
      template_key: "listing_message",
      payload: { name: "Buyer", title: "Laptop", conversationId: "thread-123", recipientId: "u-9" },
    });
    const claim = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn(async () => ({ data: [target], error: null })),
    };
    const statusUpdate = { eq: vi.fn(async () => ({ error: null })) };
    const updates: Array<Record<string, unknown>> = [];
    const update = vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return values.status === "SENDING" ? claim : statusUpdate;
    });
    mockFrom.mockImplementation((table: string) => table === "notification_preferences"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { marketplace_activity: true } }) }) }) }
      : { update });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"message":"API key is invalid"}',
    })));

    const summary = await dispatchEmailOutbox(1, "message-job");

    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(1);
    expect(updates).toContainEqual(expect.objectContaining({
      status: "FAILED",
      last_error: expect.stringContaining("resend 401"),
    }));
    expect(mockRpc).not.toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });

  it("skips marketplace messages without explicit email opt-in", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockRpc.mockResolvedValue({ data: [job({
      template_key: "listing_message",
      payload: { title: "Laptop", conversationId: "c-1", recipientId: "u-9" },
    })], error: null });
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({})) }));
    mockFrom.mockImplementation((table: string) => table === "notification_preferences"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { marketplace_activity: false } }) }) }) }
      : { update });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const summary = await dispatchEmailOutbox(10);
    expect(summary.skipped).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "SKIPPED" }));
  });

  it("marks optional mail SKIPPED when the recipient disabled it, without calling Resend", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const outbidJob = job({ template_key: "outbid", idempotency_key: "outbid:bid:b-1" });
    mockRpc.mockResolvedValue({ data: [outbidJob], error: null });
    // The sender resolves the recipient to a user id first (listUsers), then
    // reads that user's live preferences row. Both hops are stubbed here.
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: mockRpc,
      from: ((table: string) => {
        if (table === "notification_preferences") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { outbid: false, ending_soon: true, marketplace_activity: false },
                  error: null,
                }),
              }),
            }),
          };
        }
        const update = vi.fn(() => ({ eq: vi.fn(async () => ({})) }));
        return { update };
      }) as never,
      auth: {
        admin: {
          listUsers: vi.fn(async () => ({
            data: { users: [{ id: "u-9", email: "buyer@example.com" }] },
          })),
        },
      },
    } as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const summary = await dispatchEmailOutbox(10);
    expect(summary.skipped).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });

  it("records provider failures on the row instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockRpc.mockResolvedValue({ data: [job()], error: null });
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({})) }));
    mockFrom.mockReturnValue({ update });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => "bad request" }))
    );
    const summary = await dispatchEmailOutbox(10);
    expect(summary.failed).toBe(1);
    expect(update).toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });
});
