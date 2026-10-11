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

/** Merchant secrets live on the server. PAYMENT_PROVIDER selects only the
 * NEW checkout rail; signed callbacks from both historical rails are retained.
 * No configuration, partial configuration, or invalid preference fails closed.
 */

const INTEGRATION_ID = "PAYNOW_INTEGRATION_ID";
const INTEGRATION_KEY = "PAYNOW_INTEGRATION_KEY";
const PAYNOW_CURRENCY_CONFIRMATION = "PAYNOW_INTEGRATION_CURRENCY";

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
  // Paynow's regular initiate/status messages DO NOT carry a currency field.
  // The currency is defined in merchant integration payment methods. This
  // explicit attestation is mandatory before permitting USD-denominated sales.
  const verifiedCurrency = credential(env, PAYNOW_CURRENCY_CONFIRMATION).toUpperCase();

  if (!integrationId && !integrationKey && !verifiedCurrency) {
    return { state: "unset", missing: [], config: null };
  }

  const missing: string[] = [];
  if (!integrationId) missing.push(INTEGRATION_ID);
  if (!integrationKey) missing.push(INTEGRATION_KEY);
  if (verifiedCurrency !== "USD") missing.push(PAYNOW_CURRENCY_CONFIRMATION);
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

/** Explicit provider selection without removing historical provider credentials.
 * Unset preserves the prior Linkwa-first behaviour until a deliberate switch.
 * Invalid selection fails closed rather than silently changing who collects money.
 */
export type CheckoutProviderPreference = "auto" | "linkwa" | "paynow" | "invalid";

export function readCheckoutProviderPreference(
  env: Environment = process.env
): CheckoutProviderPreference {
  const raw = (env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
  if (!raw || raw === "auto") return "auto";
  if (raw === "linkwa" || raw === "paynow") return raw;
  return "invalid";
}

/** Encoding is only a ROUTING HINT, never authentication. Each adapter must
 * still verify its own original signed/HMAC'd bytes before any ledger write.
 * Linkwa sends JSON; Paynow posts urlencoded form status updates.
 */
export function webhookProviderKind(rawBody: string): "linkwa" | "paynow" | null {
  const body = rawBody.trim();
  if (body.startsWith("{")) return "linkwa";
  if (/^[a-z][a-z0-9_]*=/i.test(body)) return "paynow";
  return null;
}

function configuredLinkwaProvider(config: LinkwaEnvironment): PaymentProvider {
  return new LinkwaPaymentProvider({
    ...config,
    returnUrl: absoluteUrl("/dashboard/transactions"),
    ledger: supabasePaymentLedger(),
  });
}

function configuredPaynowProvider(config: PaynowEnvironment): PaymentProvider {
  return new PaynowPaymentProvider({
    ...config,
    resultUrl: absoluteUrl("/api/payments/webhook"),
    returnUrl: absoluteUrl("/dashboard/transactions"),
    ledger: supabasePaymentLedger(),
  });
}

/** Valid historical signed callbacks must remain processable when NEW
 * checkouts switch providers. Never infer a payment's status from its body
 * encoding; this chooses which adapter will authenticate the signed message.
 */
export function webhookPaymentProvider(rawBody: string): PaymentProvider {
  if (!hasAdminCredentials()) return new NoopPaymentProvider();
  const kind = webhookProviderKind(rawBody);
  if (kind === "linkwa") {
    const env = readLinkwaEnvironment();
    return env.state === "ready" && env.config
      ? configuredLinkwaProvider(env.config)
      : new NoopPaymentProvider();
  }
  if (kind === "paynow") {
    const env = readPaynowEnvironment();
    return env.state === "ready" && env.config
      ? configuredPaynowProvider(env.config)
      : new NoopPaymentProvider();
  }
  return new NoopPaymentProvider();
}

let initialised = false;
let bootError: string | null = null;

/** Select only NEW buyer checkouts. Existing Linkwa signatures remain
 * acceptable at the webhook irrespective of which provider is selected.
 */
export function ensurePaymentProvider(): PaymentProvider {
  if (initialised) return getPaymentProvider();
  initialised = true;

  const preference = readCheckoutProviderPreference();
  if (preference === "invalid") {
    bootError = "PAYMENT_PROVIDER must be paynow, linkwa or auto. Checkout disabled.";
    return getPaymentProvider();
  }

  const linkwa = readLinkwaEnvironment();
  const paynow = readPaynowEnvironment();

  // Legacy default: complete Linkwa config wins; a half-configured Linkwa
  // must fail closed, rather than quietly routing payments to Paynow.
  const selected = preference === "auto"
    ? linkwa.state === "unset" ? "paynow" : "linkwa"
    : preference;
  const target = selected === "linkwa" ? linkwa : paynow;
  if (target.state !== "ready" || !target.config) {
    bootError = selected + " checkout is " + target.state
      + (target.state === "incomplete" ? ": missing " + target.missing.join(", ") : "")
      + "; leaving payment provider unconfigured.";
    return getPaymentProvider();
  }

  if (!hasAdminCredentials()) {
    bootError = "SUPABASE_SECRET_KEY is not configured, so payment events cannot be recorded. Checkout disabled.";
    return getPaymentProvider();
  }

  if (selected === "linkwa" && linkwa.state === "ready" && linkwa.config) {
    setPaymentProvider(configuredLinkwaProvider(linkwa.config));
  } else if (selected === "paynow" && paynow.state === "ready" && paynow.config) {
    setPaymentProvider(configuredPaynowProvider(paynow.config));
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
