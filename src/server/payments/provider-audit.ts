import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { readLinkwaEnvironment } from "./config";
import { fetchLinkwaBalance, fetchLinkwaStatement } from "./linkwa-payouts";
import { PaymentProviderRequestError } from "./provider";

type ReadResult = { ok: boolean; httpStatus?: number; [key: string]: unknown };
export type ProviderAuditResult = {
  status: "PASSED" | "PARTIAL" | "FAILED";
  apiAuthorized: boolean;
  collectionProven: false;
  reason: string | null;
  balance: ReadResult | null;
  statement: ReadResult | null;
};

export type ProviderAuditStore = {
  claim(id: string, commit: string | null): Promise<boolean>;
  finish(id: string, result: ProviderAuditResult): Promise<void>;
};

function failedRead(error: unknown): ReadResult {
  return {
    ok: false,
    ...(error instanceof PaymentProviderRequestError && error.httpStatus
      ? { httpStatus: error.httpStatus } : {}),
  };
}

/** These are read-only app-scoped endpoints. A successful authorization check
 * never marks a collection paid, clears user funds, or proves wallet receipt.
 */
export async function inspectLinkwaProduction(): Promise<ProviderAuditResult> {
  const env = readLinkwaEnvironment();
  let live = false;
  if (env.config) {
    try {
      const base = new URL(env.config.baseUrl);
      live = base.origin === "https://linkwa.co.zw" && !base.username && !base.password
        && !base.search && !base.hash && /^\/?$/.test(base.pathname)
        && env.config.apiKey.startsWith("sk_live_");
    } catch { /* Incomplete configuration is recorded below. */ }
  }
  if (env.state !== "ready" || !env.config || !live) {
    return { status: "FAILED", apiAuthorized: false, collectionProven: false,
      reason: "production_configuration_unverified", balance: null, statement: null };
  }
  // Keep this maintenance check bounded during application initialization.
  const config = { ...env.config, fetchImpl: ((input, init) => fetch(input, {
    ...init, signal: AbortSignal.timeout(5_000),
  })) as typeof fetch };
  const [balances, statement] = await Promise.allSettled([
    fetchLinkwaBalance(config),
    fetchLinkwaStatement(config, { currencyCode: "USD", perPage: 100 }),
  ]);
  const balanceResult: ReadResult = balances.status === "fulfilled"
    ? { ok: true, balances: balances.value.map((b) => ({
        currency: b.currency, availableMinor: b.availableMinor.toString(), pendingMinor: b.pendingMinor.toString(),
      })) }
    : failedRead(balances.reason);
  const statementResult: ReadResult = statement.status === "fulfilled"
    ? { ok: true, coverage: "one_page_only", pageSize: 100,
        entries: statement.value.map((entry) => ({
          id: entry.id, type: entry.type, currency: entry.currency,
          amountMinor: entry.amountMinor.toString(),
          balanceAfterMinor: entry.balanceAfterMinor?.toString() ?? null,
          createdAt: entry.createdAt,
        })) }
    : failedRead(statement.reason);
  const apiAuthorized = balanceResult.ok || statementResult.ok;
  return {
    status: balanceResult.ok && statementResult.ok ? "PASSED" : apiAuthorized ? "PARTIAL" : "FAILED",
    apiAuthorized, collectionProven: false, reason: apiAuthorized ? null : "provider_reads_failed",
    balance: balanceResult, statement: statementResult,
  };
}

function supabaseAuditStore(): ProviderAuditStore {
  const admin = createAdminClient();
  return {
    async claim(id, commit) {
      const { data, error } = await admin.rpc("claim_payment_provider_check", { p_id: id, p_commit: commit })
        .abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("Provider audit reservation unavailable.");
      return data === true;
    },
    async finish(id, result) {
      const { data, error } = await admin.rpc("finish_payment_provider_check", { p_id: id, p_result: result })
        .abortSignal(AbortSignal.timeout(5_000));
      if (error || data !== true) throw new Error("Provider audit result unavailable.");
    },
  };
}

/** Explicit, owner-queued maintenance request. The private row is claimed
 * atomically across cold starts; no public endpoint can queue a check.
 * Leaving the flag unset costs no database or provider request.
 */
export async function runRequestedProviderAudit(store?: ProviderAuditStore): Promise<void> {
  const id = process.env.PAYMENT_HEALTH_AUDIT_ID ?? "";
  if (process.env.VERCEL_ENV !== "production" || !hasAdminCredentials()
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  const target = store ?? supabaseAuditStore();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  if (!(await target.claim(id, /^[a-f0-9]{40}$/.test(commit) ? commit : null))) return;
  await target.finish(id, await inspectLinkwaProduction());
}
