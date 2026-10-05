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
};

let sessionUserId: string | null = "admin-user";
let isAdmin = true;
let payoutRow: PayoutRow | null;
let txRow: { id: string; status: string } | null;
let recipientRow: { provider: string; external_user_id: string; external_wallet_id: string } | null;
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
  };
}

function chainFor(table: string) {
  const maybe = async () => {
    if (table === "profiles") return { data: { is_admin: isAdmin }, error: null };
    if (table === "seller_payouts") return { data: payoutRow, error: null };
    if (table === "transactions") return { data: txRow, error: null };
    if (table === "seller_payout_recipients") return { data: recipientRow, error: null };
    return { data: null, error: null };
  };
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn(maybe) })),
    })),
  };
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
