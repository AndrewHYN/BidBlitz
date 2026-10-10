import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { readLinkwaEnvironment } from "./config";
import { fetchLinkwaBalance, instructLinkwaPayout } from "./linkwa-payouts";
import { paymentsRuntimeEnabled, linkwaPayoutInstructionsEnabled } from "./runtime";
import { releaseSellerPayout } from "./seller-payout";
import { PaymentProviderRequestError } from "./provider";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./config", () => ({ readLinkwaEnvironment: vi.fn() }));
vi.mock("./linkwa-payouts", () => ({
  fetchLinkwaBalance: vi.fn(), instructLinkwaPayout: vi.fn(),
}));
vi.mock("./runtime", () => ({ paymentsRuntimeEnabled: vi.fn(), linkwaPayoutInstructionsEnabled: vi.fn() }));

const payoutId = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
const inserted = vi.fn();

function installDatabase(externalClaim: { status: string } | null = null, externalError = false) {
  const rows: Record<string, unknown> = {
    seller_payouts: {
      id: payoutId, transaction_id: "sale-1", seller_id: "seller-1",
      amount_minor: 950, currency: "USD", status: "PAYOUT_PENDING",
      payout_reference: null, delivery_confirmed_at: "2026-10-08T12:00:00Z",
    },
    transactions: { status: "PAID" },
    transaction_disputes: null,
    seller_payout_events: [],
    seller_payout_recipients: {
      setup_status: "READY", external_user_id: "user-1",
      external_wallet_id: "wallet-1", wallet_provider: "smilecash",
    },
  };
  const database = {
    rpc,
    from: vi.fn((table: string) => {
      const result = {
        data: table === "external_seller_payout_claims" ? externalClaim : rows[table],
        error: table === "external_seller_payout_claims" && externalError ? { message: "connection lost" } : null,
      };
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query),
        neq: vi.fn(() => query), limit: vi.fn(() => query),
        maybeSingle: vi.fn(async () => result),
        insert: vi.fn(async (value) => { inserted(table, value); return { error: null }; }),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue(database as unknown as ReturnType<typeof createAdminClient>);
}

beforeEach(() => {
  vi.clearAllMocks();
  installDatabase();
  vi.mocked(paymentsRuntimeEnabled).mockResolvedValue(true);
  vi.mocked(linkwaPayoutInstructionsEnabled).mockResolvedValue(true);
  vi.mocked(readLinkwaEnvironment).mockReturnValue({
    state: "ready", missing: [],
    config: { apiKey: "test-key", baseUrl: "https://linkwa.co.zw", webhookSecret: "test-secret" },
  });
  vi.mocked(fetchLinkwaBalance).mockResolvedValue([
    { currency: "USD", availableMinor: 1000n, pendingMinor: 0n },
  ]);
  vi.mocked(instructLinkwaPayout).mockResolvedValue({
    payoutId: "provider-payout-1", amountMinor: 950n, currency: "USD",
  });
  rpc.mockImplementation(async (name: string, input: { p_to_status?: string }) => ({
    data: name === "service_record_payout_instruction"
      ? { ok: true, already: false, status: "PAYOUT_DUE" }
      : { ok: true, already: false, status: input.p_to_status, payout_id: payoutId },
    error: null,
  }));
});

describe("seller payout atomic claim", () => {
  it("blocks the Linkwa POST, claim and balance request when direct provider payouts are locked", async () => {
    vi.mocked(linkwaPayoutInstructionsEnabled).mockResolvedValue(false);
    expect(await releaseSellerPayout(payoutId)).toMatchObject({
      ok: false, code: "provider_instructions_disabled",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchLinkwaBalance).not.toHaveBeenCalled();
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("records a sanitized rejection and never makes the claim retryable", async () => {
    vi.mocked(instructLinkwaPayout).mockRejectedValue(new PaymentProviderRequestError("private provider response", 422));
    expect(await releaseSellerPayout(payoutId)).toMatchObject({ ok: false, code: "provider_failed" });
    expect(inserted).toHaveBeenCalledWith("seller_payout_events", {
      payout_id: payoutId, from_status: "PAYOUT_DUE", to_status: "PAYOUT_DUE",
      note: "Linkwa payout attempt failed with HTTP 422. Reconcile the provider statement before any retry.",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(instructLinkwaPayout).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(inserted.mock.calls)).not.toContain("private provider response");
  });

  it("never stores arbitrary exception messages or secrets", async () => {
    vi.mocked(instructLinkwaPayout).mockRejectedValue(new Error("Bearer SECRET-KEY private phone"));
    expect(await releaseSellerPayout(payoutId)).toMatchObject({ ok: false, code: "provider_failed" });
    expect(inserted).toHaveBeenCalledWith("seller_payout_events", expect.objectContaining({
      to_status: "PAYOUT_DUE", note: expect.stringContaining("Provider outcome is unconfirmed"),
    }));
    expect(JSON.stringify(inserted.mock.calls)).not.toContain("SECRET-KEY");
  });
  it("sends exactly the frozen 95% after a newly acquired claim", async () => {
    expect(await releaseSellerPayout(payoutId)).toMatchObject({ ok: true, status: "PAYOUT_DUE", payoutReference: "provider-payout-1" });
    expect(rpc).toHaveBeenCalledWith("service_record_payout_instruction", {
      p_payout_id: payoutId, p_provider_reference: "provider-payout-1",
    });
    expect(inserted).not.toHaveBeenCalledWith("notifications", expect.objectContaining({ type: "PAYOUT_SENT" }));
    expect(instructLinkwaPayout).toHaveBeenCalledExactlyOnceWith(
      { apiKey: "test-key", baseUrl: "https://linkwa.co.zw" },
      { externalUserId: "user-1", externalWalletId: "wallet-1", amountMinor: 950n },
    );
  });

  it.each([
    { ok: true, already: true, status: "PAYOUT_DUE", payout_id: payoutId },
    null,
    { ok: true, status: "PAYOUT_DUE", payout_id: payoutId },
    { ok: false, already: false, status: "PAYOUT_DUE", payout_id: payoutId },
    { ok: true, already: false, status: "HELD", payout_id: payoutId },
    { ok: true, already: false, status: "PAYOUT_DUE", payout_id: "another-payout" },
  ])("does not send money without an exclusive matching claim: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await releaseSellerPayout(payoutId)).toMatchObject({
      ok: false, code: "manual_reconciliation_required",
    });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("allows only one provider call when two workers read the same pending payout", async () => {
    let balanceReads = 0;
    let unblock!: () => void;
    const bothWorkersReady = new Promise<void>((resolve) => { unblock = resolve; });
    vi.mocked(fetchLinkwaBalance).mockImplementation(async () => {
      if (++balanceReads === 2) unblock();
      await bothWorkersReady;
      return [{ currency: "USD", availableMinor: 1000n, pendingMinor: 0n }];
    });
    let claimed = false;
    rpc.mockImplementation(async (name: string, input: { p_to_status?: string }) => {
      if (name === "service_record_payout_instruction") {
        return { data: { ok: true, already: false, status: "PAYOUT_DUE" }, error: null };
      }
      const already = input.p_to_status === "PAYOUT_DUE" && claimed;
      if (input.p_to_status === "PAYOUT_DUE") claimed = true;
      return { data: { ok: true, already, status: input.p_to_status, payout_id: payoutId }, error: null };
    });
    const results = await Promise.all([releaseSellerPayout(payoutId), releaseSellerPayout(payoutId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(instructLinkwaPayout).toHaveBeenCalledTimes(1);
  });

  it("refuses to report success when the provider accepted a payout but recording failed", async () => {
    rpc.mockImplementation(async (name: string, input: { p_to_status?: string }) =>
      name === "service_record_payout_instruction"
        ? { data: null, error: { message: "DB unavailable" } }
        : { data: { ok: true, already: false, status: input.p_to_status, payout_id: payoutId }, error: null }
    );
    expect(await releaseSellerPayout(payoutId)).toMatchObject({
      ok: false, code: "manual_reconciliation_required",
    });
    expect(instructLinkwaPayout).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("service_transition_seller_payout", expect.objectContaining({
      p_to_status: "PAID_OUT",
    }));
  });

  it("rejects an external SmileCash/EcoCash reservation without calling Linkwa", async () => {
    installDatabase({ status: "RESERVED" });
    expect(await releaseSellerPayout(payoutId)).toMatchObject({
      ok: false, code: "manual_reconciliation_required",
    });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
    expect(fetchLinkwaBalance).not.toHaveBeenCalled();
  });

  it("does not send money when the external claim lookup fails", async () => {
    installDatabase(null, true);
    expect(await releaseSellerPayout(payoutId)).toMatchObject({
      ok: false, code: "manual_reconciliation_required",
    });
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });

  it("keeps the kill switch ahead of all provider calls", async () => {
    vi.mocked(paymentsRuntimeEnabled).mockResolvedValue(false);
    expect(await releaseSellerPayout(payoutId)).toMatchObject({ ok: false, code: "payments_paused" });
    expect(fetchLinkwaBalance).not.toHaveBeenCalled();
    expect(instructLinkwaPayout).not.toHaveBeenCalled();
  });
});
