import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { readLinkwaEnvironment } from "@/server/payments/config";
import { instructLinkwaPayout } from "@/server/payments/linkwa-payouts";
import { initiateLinkwaPayoutAction } from "./linkwa-payouts";

/**
 * The admin Linkwa payout action's contract.
 *
 * These tests pin the controls that matter when money moves:
 *   - authorization (no session, non-admin);
 *   - exactly one instruction per payout (duplicate refusal + atomic claim);
 *   - a provider payout already recorded in the audit trail is never sent
 *     again (the 2026-10-05 provider/ledger mismatch class);
 *   - the amount comes from the frozen ledger, never from the browser;
 *   - the recipient comes from the server-side recipient table, never the body;
 *   - a wrong/foreign transaction is refused before any network call;
 *   - a provider failure is never recorded as success.
 *
 * The database's own state machine (admin_transition_seller_payout) is proven
 * by migration 20260928000001; here we pin how the action calls it.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/payments/config", () => ({
  readLinkwaEnvironment: vi.fn(),
}));
vi.mock("@/server/payments/linkwa-payouts", () => ({
  instructLinkwaPayout: vi.fn(),
}));

const PAYOUT_ID = "11111111-1111-4111-8111-111111111111";
const TX_ID = "22222222-2222-4222-8222-222222222222";
const SELLER_ID = "33333333-3333-4333-8333-333333333333";

type PayoutRow = {
  id: string;
  transaction_id: string;
  seller_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  payout_reference: string | null;
  /** Explicit fulfilment fact; the DB refuses PAYOUT_DUE while this is NULL. */
  delivery_confirmed_at: string | null;
};

let sessionUserId: string | null = "admin-user";
let isAdmin = true;
let payoutRow: PayoutRow | null;
let txRow: { id: string; status: string } | null;
let recipientRow: { provider: string; external_user_id: string; external_wallet_id: string } | null;
/** Append-only seller_payout_events rows for the payout under test. */
let auditEvents: Array<{ to_status: string | null; payout_reference: string | null }>;
let auditEventsError: { message: string } | null;
/** RPC answers, keyed by target status in call order. */
let rpcResults: Array<{ data: unknown; error: { message: string } | null }>;
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

function defaultPayout(): PayoutRow {
  return {
    id: PAYOUT_ID,
    transaction_id: TX_ID,
    seller_id: SELLER_ID,
    // $9.50 net = $10.00 gross - $0.50 fee (the sandbox proof).
    amount_minor: 950,
    currency: "USD",
    status: "PAYOUT_PENDING",
    payout_reference: null,
    delivery_confirmed_at: "2026-10-05T12:00:00.000Z",
  };
}

type MockQueryResult = { data: unknown; error: { message: string } | null };
type MockBuilder = {
  in: () => MockBuilder;
  eq: () => MockBuilder;
  maybeSingle: () => Promise<MockQueryResult>;
  then: (
    onfulfilled: ((value: MockQueryResult) => unknown) | null,
    onrejected: ((reason: unknown) => unknown) | null
  ) => Promise<unknown>;
};

function chainFor(table: string) {
  const rows = (): unknown[] => {
    if (table === "profiles") return [{ is_admin: isAdmin }];
    if (table === "seller_payouts") return payoutRow ? [payoutRow] : [];
    if (table === "transactions") return txRow ? [txRow] : [];
    if (table === "seller_payout_recipients") return recipientRow ? [recipientRow] : [];
    if (table === "seller_payout_events") return auditEvents;
    return [];
  };
  const error = (): { message: string } | null =>
    table === "seller_payout_events" ? auditEventsError : null;

  // A PostgREST builder is thenable and also exposes maybeSingle(), so the
  // same object serves `.eq(...).maybeSingle()` and an awaited list read.
  const build = (): MockBuilder => ({
    in: () => build(),
    eq: () => build(),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: error() }),
    then: (onfulfilled, onrejected) =>
      Promise.resolve<MockQueryResult>({ data: rows(), error: error() }).then(
        onfulfilled,
        onrejected
      ),
  });

  return { select: vi.fn(() => build()) };
}

function mockClient() {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: sessionUserId ? { id: sessionUserId } : null } })),
    },
    from: vi.fn((table: string) => chainFor(table)),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcResults.shift() ?? { data: { ok: true, already: false }, error: null };
    }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

beforeEach(() => {
  sessionUserId = "admin-user";
  isAdmin = true;
  payoutRow = defaultPayout();
  txRow = { id: TX_ID, status: "PAID" };
  recipientRow = {
    provider: "linkwa",
    external_user_id: "01krecipientuser",
    external_wallet_id: "01krecipientwallet",
  };
  auditEvents = [];
  auditEventsError = null;
  rpcResults = [];
  rpcCalls.length = 0;
  mockClient();
  vi.mocked(readLinkwaEnvironment).mockReturnValue({
    state: "ready",
    missing: [],
    config: { apiKey: "sandbox-key", baseUrl: "https://sandbox.linkwa.test", webhookSecret: "s" },
  });
  vi.mocked(instructLinkwaPayout).mockResolvedValue({
    payoutId: "01m463ry96b1v2tbk1w42qfhjs",
    amountMinor: 950n,
    currency: "USD",
  });
});

describe("initiateLinkwaPayoutAction - authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    sessionUserId = null;
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({ ok: false, message: "Sign in." });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("refuses an authenticated non-admin", async () => {
    isAdmin = false;
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({ ok: false, message: "Admins only." });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses a malformed payout id before touching the database", async () => {
    const result = await initiateLinkwaPayoutAction({ payoutId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });
});

describe("initiateLinkwaPayoutAction - no browser-controlled money", () => {
  it("rejects a body that tries to supply an amount, recipient or reference", async () => {
    const result = await initiateLinkwaPayoutAction({
      payoutId: PAYOUT_ID,
      amountMinor: 1,
      externalUserId: "attacker",
      externalWalletId: "attacker-wallet",
      reference: "forged",
      currency: "USD",
    });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("instructs the exact frozen ledger amount, not a forged one", async () => {
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({ ok: true, payoutReference: "01m463ry96b1v2tbk1w42qfhjs" });

    const call = vi.mocked(instructLinkwaPayout).mock.calls[0];
    expect(call[1].amountMinor).toBe(950n);
    // Recipient came from the server-side row, not from the request.
    expect(call[1].externalUserId).toBe("01krecipientuser");
    expect(call[1].externalWalletId).toBe("01krecipientwallet");
  });

  it("refuses a non-USD ledger row instead of converting or guessing", async () => {
    payoutRow = { ...defaultPayout(), currency: "ZWL" };
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });
});

describe("initiateLinkwaPayoutAction - ledger and transaction guards", () => {
  it("refuses an unknown payout", async () => {
    payoutRow = null;
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({ ok: false, message: "That payout no longer exists." });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("refuses a payout that is not in PAYOUT_PENDING", async () => {
    payoutRow = { ...defaultPayout(), status: "WAITING_FOR_FULFILMENT" };
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(String((result as { message: string }).message)).toContain("Payout pending");
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("refuses a payout already recorded as PAID_OUT (duplicate)", async () => {
    payoutRow = {
      ...defaultPayout(),
      status: "PAID_OUT",
      payout_reference: "01m463ry96b1v2tbk1w42qfhjs",
    };
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({
      ok: false,
      message: "This payout is already recorded as paid out.",
    });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses a payout that already carries a reference", async () => {
    payoutRow = { ...defaultPayout(), payout_reference: "manual-bank-ref" };
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("refuses when the transaction is not PAID (wrong or unpaid sale)", async () => {
    txRow = { id: TX_ID, status: "AWAITING_PAYMENT" };
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses when the transaction row is missing entirely", async () => {
    txRow = null;
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("refuses when the payout's transaction was refunded", async () => {
    txRow = { id: TX_ID, status: "REFUNDED" };
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("refuses when no recipient is on file server-side", async () => {
    recipientRow = null;
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({
      ok: false,
      message: "No Linkwa payout recipient is on file for this seller.",
    });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("refuses when Linkwa is not configured, without touching the payout state", async () => {
    vi.mocked(readLinkwaEnvironment).mockReturnValue({
      state: "unset",
      missing: [],
      config: null,
    });
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("initiateLinkwaPayoutAction - exactly one instruction", () => {
  it("claims PAYOUT_PENDING -> PAYOUT_DUE before instructing and records PAID_OUT after", async () => {
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(true);

    expect(rpcCalls.map((c) => c.args.p_to_status)).toEqual(["PAYOUT_DUE", "PAID_OUT"]);
    expect(rpcCalls[0].fn).toBe("admin_transition_seller_payout");
    // The recorded reference is Linkwa's own payout id, not anything from the browser.
    expect(rpcCalls[1].args.p_payout_reference).toBe("01m463ry96b1v2tbk1w42qfhjs");
  });

  it("refuses a duplicate attempt that lost the claim race", async () => {
    rpcResults = [{ data: { ok: true, already: true, status: "PAYOUT_DUE" }, error: null }];
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result).toEqual({
      ok: false,
      message: "This payout is already being processed. Reload and try again.",
    });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(1);
  });

  it("refuses when the claim is rejected by the database", async () => {
    rpcResults = [{ data: null, error: { message: "payout_invalid_transition" } }];
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("j) cannot bypass delivery: refuses before any claim when delivery is NULL", async () => {
    payoutRow = { ...defaultPayout(), delivery_confirmed_at: null };
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Delivery has not been confirmed");
    expect(rpcCalls).toHaveLength(0);
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("j) surfaces the database's delivery refusal and never calls the provider", async () => {
    rpcResults = [{ data: null, error: { message: "payout_delivery_not_confirmed" } }];
    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Delivery has not been confirmed");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_to_status).toBe("PAYOUT_DUE");
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });
});

describe("initiateLinkwaPayoutAction - provider failure", () => {
  it("never marks the payout PAID_OUT when Linkwa fails; holds it with the reason", async () => {
    vi.mocked(instructLinkwaPayout).mockRejectedValue(
      new Error("Linkwa answered HTTP 422 for the payout request.")
    );

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("nothing was sent");

    const statuses = rpcCalls.map((c) => c.args.p_to_status);
    expect(statuses).not.toContain("PAID_OUT");
    expect(statuses).toContain("HELD");
    const held = rpcCalls.find((c) => c.args.p_to_status === "HELD");
    expect(String(held?.args.p_internal_note)).toContain("failed before any money moved");
  });

  it("surfaces the honest double-check message when Linkwa pays but recording fails", async () => {
    rpcResults = [
      { data: { ok: true, already: false }, error: null }, // claim
      { data: null, error: { message: "payout_invalid_transition" } }, // PAID_OUT record
    ];

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("01m463ry96b1v2tbk1w42qfhjs");
      expect(result.message).toContain("do not re-instruct");
    }
    // The second RPC was the record attempt; no third retry was attempted.
    expect(rpcCalls).toHaveLength(2);
  });
});

/**
 * Regression: the 2026-10-05 provider/ledger mismatch.
 *
 * Linkwa executed payout 01m463ry96b1v2tbk1w42qfhjs for the $9.50 net of
 * transaction b44c3c45-8186-4eb1-98c8-db4b9a6d7c58 while its seller_payout
 * row sat in WAITING_FOR_FULFILMENT, so provider and ledger disagreed. Linkwa
 * documents NO payout status endpoint and NO payout webhook, so nothing
 * outside our own ledger can ever tell us that a payout already went out.
 * These tests pin every way the console must refuse to send that money twice.
 *
 * The row has since been reconciled to PAID_OUT with that reference (ADR-016),
 * which makes it a historical sandbox fixture: it may be read as history, and
 * it can never become actionable again.
 */
describe("initiateLinkwaPayoutAction - provider/ledger mismatch (regression)", () => {
  const RECONCILED_REF = "01m463ry96b1v2tbk1w42qfhjs";

  it("refuses the pre-reconciliation ledger state (WAITING_FOR_FULFILMENT)", async () => {
    payoutRow = { ...defaultPayout(), status: "WAITING_FOR_FULFILMENT" };

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Payout pending");
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("never re-instructs the reconciled row (PAID_OUT carrying the provider reference)", async () => {
    payoutRow = {
      ...defaultPayout(),
      status: "PAID_OUT",
      payout_reference: RECONCILED_REF,
    };

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });

    expect(result).toEqual({
      ok: false,
      message: "This payout is already recorded as paid out.",
    });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses a payout whose append-only audit trail already records a provider payout", async () => {
    // Defence in depth: the status column still says PAYOUT_PENDING and the
    // reference column is still empty, but the audit trail - which nobody can
    // edit - proves the money already left.
    auditEvents = [{ to_status: "PAID_OUT", payout_reference: RECONCILED_REF }];

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("audit trail");
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("fails closed when the audit trail cannot be read", async () => {
    auditEventsError = { message: "connection lost" };

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("no payout was sent");
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("still pays a clean payout: an audit trail with only creation events passes", async () => {
    auditEvents = [{ to_status: "WAITING_FOR_FULFILMENT", payout_reference: null }];

    const result = await initiateLinkwaPayoutAction({ payoutId: PAYOUT_ID });

    expect(result).toEqual({ ok: true, payoutReference: RECONCILED_REF });
    expect(rpcCalls.map((c) => c.args.p_to_status)).toEqual(["PAYOUT_DUE", "PAID_OUT"]);
  });
});
