import { hasAdminCredentials } from "@/lib/supabase/admin";
import { absoluteUrl } from "@/lib/site-url";
import {
  NoopPaymentProvider,
  getPaymentProvider,
  setPaymentProvider,
  type PaymentProvider,
} from "./provider";
import { PaynowPaymentProvider } from "./paynow";
import { LinkwaPaymentProvider } from "./linkwa";
import { supabasePaymentLedger } from "./ledger";

/**
 * Credential-driven provider selection — the ONLY module allowed to know
 * which payment provider is in use.
 *
 * Selection order (see ADR-016 for why Linkwa leads):
 *   1. Linkwa complete  => LinkwaPaymentProvider (collect + programmatic
 *                          payouts, the marketplace pair);
 *   2. Paynow ready     => PaynowPaymentProvider, wired to the Supabase ledger;
 *   3. otherwise        => NoopPaymentProvider (the honest default, and the
 *                          state BidBlitz ships in).
 *
 * Rules:
 *   - no credentials  => NoopPaymentProvider (the honest default, and the
 *                        state BidBlitz ships in);
 *   - both present    => Linkwa wins; Paynow stays configured as the
 *                        documented fallback, never silently half-live;
 *   - half configured => stay on Noop AND record why, so the failure is
 *                        reported instead of silently ignored. A half-set
 *                        integration must never look like a working one.
 *
 * Credentials come from environment variables only and are never written to
 * the repository (placeholders live in `.env.example`). See ADR-011 (Paynow)
 * and ADR-016 (Linkwa) for the onboarding steps that produce them.
 */

const INTEGRATION_ID = "PAYNOW_INTEGRATION_ID";
const INTEGRATION_KEY = "PAYNOW_INTEGRATION_KEY";

const LINKWA_API_KEY = "LINKWA_API_KEY";
const LINKWA_BASE_URL = "LINKWA_BASE_URL";
const LINKWA_WEBHOOK_SECRET = "LINKWA_WEBHOOK_SECRET";

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

export type LinkwaEnvironment = {
  apiKey: string;
  baseUrl: string;
  webhookSecret: string;
};

export type LinkwaEnvironmentState = {
  state: "unset" | "ready" | "incomplete";
  /** Names that are missing or still carrying the placeholder value. */
  missing: string[];
  config: LinkwaEnvironment | null;
};

/**
 * Linkwa needs all three: the key alone can neither collect nor verify.
 * The base URL has no safe default — the wrong origin would send money
 * somewhere unobserved — so it is required explicitly, sandbox or prod.
 */
export function readLinkwaEnvironment(
  env: Environment = process.env
): LinkwaEnvironmentState {
  const apiKey = credential(env, LINKWA_API_KEY);
  const baseUrl = credential(env, LINKWA_BASE_URL);
  const webhookSecret = credential(env, LINKWA_WEBHOOK_SECRET);

  if (!apiKey && !baseUrl && !webhookSecret) {
    return { state: "unset", missing: [], config: null };
  }

  const missing: string[] = [];
  if (!apiKey) missing.push(LINKWA_API_KEY);
  if (!baseUrl) missing.push(LINKWA_BASE_URL);
  if (!webhookSecret) missing.push(LINKWA_WEBHOOK_SECRET);
  if (missing.length > 0) {
    return { state: "incomplete", missing, config: null };
  }

  return {
    state: "ready",
    missing: [],
    config: { apiKey, baseUrl, webhookSecret },
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

  const linkwa = readLinkwaEnvironment();
  const paynow = readPaynowEnvironment();

  if (linkwa.state === "ready" && linkwa.config) {
    if (!hasAdminCredentials()) {
      bootError =
        "Linkwa credentials are present but SUPABASE_SECRET_KEY is not, so a payment " +
        "event could never be recorded. Leaving the provider unconfigured.";
      return getPaymentProvider();
    }

    setPaymentProvider(
      new LinkwaPaymentProvider({
        apiKey: linkwa.config.apiKey,
        baseUrl: linkwa.config.baseUrl,
        webhookSecret: linkwa.config.webhookSecret,
        // Callbacks must come back to the canonical origin, never to whatever
        // host a given request happened to arrive on (see site-url.ts).
        returnUrl: absoluteUrl("/dashboard/transactions"),
        ledger: supabasePaymentLedger(),
      })
    );
    return getPaymentProvider();
  }

  // A half-set Linkwa must be as loud as a half-set Paynow: name every
  // missing piece instead of silently falling through to the other provider.
  if (linkwa.state === "incomplete") {
    bootError =
      `Linkwa configuration incomplete: ${linkwa.missing.join(", ")} is missing or still ` +
      "a placeholder. Leaving the honest Noop provider in place.";
    return getPaymentProvider();
  }

  const env = paynow;

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

/**
 * Who the user is actually paying through, for copy that names the provider.
 * Server components pass this into interactive controls so a message about a
 * live provider interaction never names the wrong one. Never used for
 * decisions — only for words.
 */
export function paymentProviderDisplayName(): string {
  return ensurePaymentProvider().capabilities.displayName;
}

/**
 * Whether the configured provider exposes a trustworthy server-side status
 * reconciliation method. Linkwa currently confirms payments by signed webhook,
 * so the UI must not offer a button that can only return 501.
 */
export function paymentProviderSupportsReconciliation(): boolean {
  const provider = ensurePaymentProvider();
  return provider.capabilities.configured && typeof provider.reconcile === "function";
}

/** Test hook: forget the boot decision and return to the honest default. */
export function resetPaymentProviderForTests(): void {
  initialised = false;
  bootError = null;
  setPaymentProvider(new NoopPaymentProvider());
}
