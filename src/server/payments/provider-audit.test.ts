import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectLinkwaProduction, runRequestedProviderAudit, type ProviderAuditStore } from "./provider-audit";
import { PaymentProviderRequestError } from "./provider";

const mocks = vi.hoisted(() => ({
  config: vi.fn(), credentials: vi.fn(), balances: vi.fn(), statement: vi.fn(), admin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ hasAdminCredentials: mocks.credentials, createAdminClient: mocks.admin }));
vi.mock("./config", () => ({ readLinkwaEnvironment: mocks.config }));
vi.mock("./linkwa-payouts", () => ({ fetchLinkwaBalance: mocks.balances, fetchLinkwaStatement: mocks.statement }));

const ID = "00000000-0000-4000-8000-000000000001";
const config = { apiKey: "sk_live_PRIVATE", webhookSecret: "PRIVATE_SIGNING_SECRET", baseUrl: "https://linkwa.co.zw" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({ state: "ready", config });
  mocks.credentials.mockReturnValue(true);
  mocks.balances.mockResolvedValue([{ currency: "USD", availableMinor: 123n, pendingMinor: 45n }]);
  mocks.statement.mockResolvedValue([{ id: "ledger-entry", type: "credit", currency: "USD", amountMinor: 123n,
    balanceAfterMinor: 123n, createdAt: "2026-10-28T00:00:00Z", description: "PRIVATE CUSTOMER", recipientType: "private" }]);
  vi.stubEnv("PAYMENT_HEALTH_AUDIT_ID", ID);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
});
afterEach(() => vi.unstubAllEnvs());

describe("Linkwa production read-only audit", () => {
  it("records exact amounts and bounded ledger evidence without declaring a collection proven", async () => {
    const result = await inspectLinkwaProduction();
    expect(result).toMatchObject({ status: "PASSED", apiAuthorized: true, collectionProven: false,
      balance: { ok: true, balances: [{ currency: "USD", availableMinor: "123", pendingMinor: "45" }] },
      statement: { coverage: "one_page_only", pageSize: 100 } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(mocks.statement).toHaveBeenCalledWith(expect.objectContaining(config), { currencyCode: "USD", perPage: 100 });
  });
  it("does not turn an empty app balance or history into settlement proof", async () => {
    mocks.balances.mockResolvedValue([]); mocks.statement.mockResolvedValue([]);
    expect(await inspectLinkwaProduction()).toMatchObject({ apiAuthorized: true, collectionProven: false,
      balance: { balances: [] }, statement: { entries: [] } });
  });
  it.each(["https://sandbox.linkwa.co.zw", "https://linkwa.co.zw.evil.example", "https://user@linkwa.co.zw",
    "http://linkwa.co.zw", "https://linkwa.co.zw/?token=PRIVATE"])("rejects an unverified production origin %s", async (baseUrl) => {
    mocks.config.mockReturnValue({ state: "ready", config: { ...config, baseUrl } });
    expect(await inspectLinkwaProduction()).toMatchObject({ status: "FAILED", reason: "production_configuration_unverified" });
    expect(mocks.balances).not.toHaveBeenCalled(); expect(mocks.statement).not.toHaveBeenCalled();
  });
  it("rejects sandbox credentials even on the production host", async () => {
    mocks.config.mockReturnValue({ state: "ready", config: { ...config, apiKey: "sk_test_PRIVATE" } });
    expect((await inspectLinkwaProduction()).apiAuthorized).toBe(false);
    expect(mocks.balances).not.toHaveBeenCalled();
  });
  it("records refusals without storing raw errors or credentials", async () => {
    mocks.balances.mockRejectedValue(new PaymentProviderRequestError("PRIVATE_KEY", 401));
    mocks.statement.mockRejectedValue(new PaymentProviderRequestError("PRIVATE_CUSTOMER", 403));
    const result = await inspectLinkwaProduction();
    expect(result).toMatchObject({ status: "FAILED", apiAuthorized: false,
      balance: { ok: false, httpStatus: 401 }, statement: { ok: false, httpStatus: 403 } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("records partial API access as partial evidence", async () => {
    mocks.statement.mockRejectedValue(new Error("PRIVATE transport detail"));
    const result = await inspectLinkwaProduction();
    expect(result).toMatchObject({ status: "PARTIAL", apiAuthorized: true, collectionProven: false, statement: { ok: false } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("explicit one-time maintenance request", () => {
  function store(): ProviderAuditStore { return { claim: vi.fn().mockResolvedValue(true), finish: vi.fn().mockResolvedValue(undefined) }; }
  it.each(["", "invalid", "../../private"])("makes no database or provider request for invalid request id %s", async (id) => {
    vi.stubEnv("PAYMENT_HEALTH_AUDIT_ID", id);
    const target = store(); await runRequestedProviderAudit(target);
    expect(target.claim).not.toHaveBeenCalled(); expect(mocks.balances).not.toHaveBeenCalled();
  });
  it("does not run from a preview deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview"); const target = store();
    await runRequestedProviderAudit(target); expect(target.claim).not.toHaveBeenCalled();
  });
  it("does not run without server credentials", async () => {
    mocks.credentials.mockReturnValue(false); const target = store();
    await runRequestedProviderAudit(target); expect(target.claim).not.toHaveBeenCalled();
  });
  it("does not rerun an already claimed, completed or expired request", async () => {
    const target = store(); vi.mocked(target.claim).mockResolvedValue(false);
    await runRequestedProviderAudit(target);
    expect(target.finish).not.toHaveBeenCalled(); expect(mocks.balances).not.toHaveBeenCalled();
  });
  it("records the observed result only after a successful claim", async () => {
    const target = store(); await runRequestedProviderAudit(target);
    expect(target.claim).toHaveBeenCalledWith(ID, "a".repeat(40));
    expect(target.finish).toHaveBeenCalledWith(ID, expect.objectContaining({ status: "PASSED", collectionProven: false }));
  });
  it("does not contact a provider when the database claim fails", async () => {
    const target = store(); vi.mocked(target.claim).mockRejectedValue(new Error("Unavailable"));
    await expect(runRequestedProviderAudit(target)).rejects.toThrow("Unavailable");
    expect(mocks.balances).not.toHaveBeenCalled();
  });
});
