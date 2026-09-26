import { hasAdminCredentials } from "@/lib/supabase/admin";
import { absoluteUrl } from "@/lib/site-url";
import {
  NoopPaymentProvider,
  getPaymentProvider,
  setPaymentProvider,
  type PaymentProvider,
} from "./provider";
import { PaynowPaymentProvider } from "./paynow";
import { supabasePaymentLedger } from "./ledger";

/**
 * Credential-driven provider selection — the ONLY module allowed to know
 * which payment provider is in use.
 *
 * Rules:
 *   - no credentials  => NoopPaymentProvider (the honest default, and the
 *                        state BidBlitz ships in);
 *   - both present    => PaynowPaymentProvider, wired to the Supabase ledger;
 *   - half configured => stay on Noop AND record why, so the failure is
 *                        reported instead of silently ignored. A half-set
 *                        integration must never look like a working one.
 *
 * Credentials come from environment variables only and are never written to
 * the repository (placeholders live in `.env.example`). See ADR-011 for the
 * onboarding step that produces them.
 */

const INTEGRATION_ID = "PAYNOW_INTEGRATION_ID";
const INTEGRATION_KEY = "PAYNOW_INTEGRATION_KEY";

export type PaynowEnvironment = {
  integrationId: string;
  integrationKey: string;
};

export type PaynowEnvironmentState = {
  state: "unset" | "ready" | "incomplete";
  /** Names that are missing or still carrying the placeholder value. */
  missing: string[];
  config: PaynowEnvironment | null;
};

/** `.env.example` values that mean "not filled in yet", not real credentials. */
const PLACEHOLDER = /REPLACE|YOUR_|PLACEHOLDER|CHANGE_?ME|^$|^<|>$/i;

/** Read-only view of an environment: just names to values, nothing else. */
export type Environment = Readonly<Record<string, string | undefined>>;

function credential(env: Environment, name: string): string {
  const value = (env[name] ?? "").trim();
  return PLACEHOLDER.test(value) ? "" : value;
}

export function readPaynowEnvironment(
  env: Environment = process.env
): PaynowEnvironmentState {
  const integrationId = credential(env, INTEGRATION_ID);
  const integrationKey = credential(env, INTEGRATION_KEY);

  if (!integrationId && !integrationKey) {
    return { state: "unset", missing: [], config: null };
  }

  const missing: string[] = [];
  if (!integrationId) missing.push(INTEGRATION_ID);
  if (!integrationKey) missing.push(INTEGRATION_KEY);
  if (missing.length > 0) {
    return { state: "incomplete", missing, config: null };
  }

  return {
    state: "ready",
    missing: [],
    config: { integrationId, integrationKey },
  };
}

let initialised = false;
let bootError: string | null = null;

/**
 * Idempotent boot step. Safe to call on every request; the first call decides.
 * When nothing is configured it deliberately leaves whatever provider a test
 * injected alone — an unset environment means "unconfigured", not "reset".
 */
export function ensurePaymentProvider(): PaymentProvider {
  if (initialised) return getPaymentProvider();
  initialised = true;

  const env = readPaynowEnvironment();

  if (env.state === "incomplete") {
    bootError =
      `Payment provider not configured: ${env.missing.join(", ")} is missing or still ` +
      "a placeholder. Leaving the honest Noop provider in place.";
    return getPaymentProvider();
  }

  if (env.state === "ready" && env.config) {
    if (!hasAdminCredentials()) {
      bootError =
        "Paynow credentials are present but SUPABASE_SECRET_KEY is not, so a payment " +
        "event could never be recorded. Leaving the provider unconfigured.";
      return getPaymentProvider();
    }

    setPaymentProvider(
      new PaynowPaymentProvider({
        ...env.config,
        // Callbacks must come back to the canonical origin, never to whatever
        // host a given request happened to arrive on (see site-url.ts).
        resultUrl: absoluteUrl("/api/payments/webhook"),
        returnUrl: absoluteUrl("/dashboard/transactions"),
        ledger: supabasePaymentLedger(),
      })
    );
  }

  return getPaymentProvider();
}

/**
 * Why the provider is still Noop despite credentials being present, or null.
 * Server-side diagnostics only — surfaced in API responses, never rendered
 * into public markup.
 */
export function paymentBootError(): string | null {
  return bootError;
}

/**
 * The read every server component should use. `isPaymentConfigured()` in
 * `provider.ts` only reflects the registry as it stands, which is Noop until
 * this module has run — so a page that reads the registry directly would
 * always claim no provider is configured, even with credentials present.
 */
export function isPaymentProviderConfigured(): boolean {
  return ensurePaymentProvider().capabilities.configured;
}

/** Test hook: forget the boot decision and return to the honest default. */
export function resetPaymentProviderForTests(): void {
  initialised = false;
  bootError = null;
  setPaymentProvider(new NoopPaymentProvider());
}
