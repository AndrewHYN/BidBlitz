import "server-only";
import {
  PaymentPayloadError,
  PaymentProviderError,
  PaymentProviderRequestError,
} from "./provider";
import { isLinkwaBaseUrl, linkwaAmountToMinor, type LinkwaConfig } from "./linkwa";

/**
 * Linkwa payouts — deliberately NOT part of `PaymentProvider` and NOT wired
 * to any UI or route.
 *
 * Moving seller money is the highest-stakes call in this codebase, and the
 * payout milestone must prove each step against the sandbox first: link a
 * wallet, instruct a payout, watch the reference land, reconcile it against
 * the statement. Until that proof exists, these helpers are tested shapes
 * waiting for a verified flow — calling them from the admin payout console
 * today would turn "Record seller payout" (a human attesting an external
 * transfer) into an unobserved API call, which is exactly the shortcut the
 * payout model exists to prevent.
 *
 * What the docs do verify (ADR-016): POST /users links a recipient by phone
 * and returns external_user_id; POST /wallets registers a SmileCash wallet
 * (auto-linked when already registered, ID details otherwise) and returns
 * external_wallet_id; POST /payouts instructs with both ids plus amount and
 * answers a payout_id plus balances. What they do NOT verify: a payout
 * STATUS endpoint, an idempotency mechanism, or a refund API — so this module
 * offers no status check, no retry wrapper and no refund, and says so loudly
 * where each would go. Sandbox proof 2026-10-05 (ADR-016): payout instructed
 * against the sandbox, GET /balance and GET /statement show the debit, the
 * documented webhook event set contains payment.completed only (no payout
 * event), and no payout status endpoint is documented. Balance/statement
 * reads ARE documented and implemented below.
 */

export type LinkwaUserLink = {
  externalUserId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
};

export type LinkwaWalletRegistration = {
  externalUserId: string;
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  idNumber?: string;
  gender?: string;
};

export type LinkwaPayoutInstruction = {
  externalUserId: string;
  externalWalletId: string;
  /** Integer minor units. Serialised to an exact two-decimal string. */
  amountMinor: bigint;
};

export type LinkwaPayoutResult = {
  payoutId: string;
  amountMinor: bigint;
  currency: string;
  /** Present only when Linkwa answered `include_balance_after` with it. */
  balanceAfter?: { availableMinor: bigint; pendingMinor: bigint; currency: string };
};

export type LinkwaBalance = {
  currency: string;
  availableMinor: bigint;
  pendingMinor: bigint;
};

export type LinkwaStatementEntry = {
  id: string;
  type: string;
  currency: string;
  description: string;
  amountMinor: bigint;
  balanceAfterMinor: bigint | null;
  createdAt: string;
  recipientType: string | null;
};

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function post<T>(
  config: Pick<LinkwaConfig, "apiKey" | "baseUrl"> & { fetchImpl?: typeof fetch },
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  let response: Response;
  try {
    response = await (config.fetchImpl ?? fetch)(
      `${config.baseUrl.trim().replace(/\/+$/, "")}${path}`,
      { method: "POST", headers: headers(config.apiKey), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }
    );
  } catch (err) {
    throw new PaymentProviderRequestError(
      `Could not reach Linkwa: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!response.ok) {
    // An explicit registration demand is actionable even on HTTP 422.
    // Never classify arbitrary provider text or expose it to the seller.
    const reply = await response.json().catch(() => null);
    if (path === "/api/v1/third-party/wallets" && response.status === 422 && reply?.requires_registration === true) {
      throw new PaymentPayloadError("wallet_registration_required", "SmileCash registration is required.");
    }
    const permittedFields = ["phone_number", "first_name", "last_name", "external_user_id", "date_of_birth", "id_number", "gender", "id_picture"];
    const validationFields = reply?.errors && typeof reply.errors === "object"
      ? Object.keys(reply.errors).filter((field) => permittedFields.includes(field)) : [];
    throw new PaymentProviderRequestError(
      `Linkwa answered HTTP ${response.status} for the payout request.`, response.status, validationFields
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new PaymentProviderRequestError("Linkwa returned a reply we cannot read.");
  }
}

function requireLinkwaConfig(config: Pick<LinkwaConfig, "apiKey" | "baseUrl">): void {
  if (!config.apiKey || !isLinkwaBaseUrl(config.baseUrl)) {
    throw new PaymentProviderError(
      "LINKWA_CONFIGURATION_INCOMPLETE",
      "Linkwa payouts need an API key and an https base URL."
    );
  }
}

/**
 * Link (or auto-create) the recipient on Linkwa by phone number. Returns the
 * external_user_id every later call needs. Never invents identity: names come
 * from the caller (the seller's verified profile), never from defaults.
 */
export async function linkLinkwaUser(
  config: Pick<LinkwaConfig, "apiKey" | "baseUrl"> & { fetchImpl?: typeof fetch },
  input: { firstName: string; lastName: string; phoneNumber: string; email?: string }
): Promise<LinkwaUserLink> {
  requireLinkwaConfig(config);
  if (!input.firstName.trim() || !input.lastName.trim() || !input.phoneNumber.trim()) {
    throw new PaymentPayloadError("invalid_request", "Linking a payout recipient needs a name and a phone number.");
  }
  const reply = await post<{
    user?: { external_user_id?: string; first_name?: string; last_name?: string; phone_number?: string };
  }>(config, "/api/v1/third-party/users", {
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    phone_number: input.phoneNumber.trim().replace(/^\+/, ""),
    ...(input.email?.trim() ? { email: input.email.trim() } : {}),
  });
  const externalUserId = reply.user?.external_user_id ?? "";
  if (!externalUserId) {
    throw new PaymentProviderRequestError("Linkwa did not return a user to link payouts to.");
  }
  return {
    externalUserId,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    phoneNumber: input.phoneNumber.trim(),
  };
}

/**
 * Register (or auto-link) the recipient's SmileCash wallet. Returns the
 * external_wallet_id payouts are instructed against. Registration details
 * are only needed when the number is not already on SmileCash — Linkwa says
 * so explicitly with `requires_registration`.
 */
export async function registerLinkwaWallet(
  config: Pick<LinkwaConfig, "apiKey" | "baseUrl"> & { fetchImpl?: typeof fetch },
  input: LinkwaWalletRegistration
): Promise<{ externalWalletId: string; provider: string }> {
  requireLinkwaConfig(config);
  if (!input.externalUserId.trim() || !input.phoneNumber.trim()) {
    throw new PaymentPayloadError("invalid_request", "Registering a wallet needs the linked user and a phone number.");
  }
  const reply = await post<{
    wallet?: { external_wallet_id?: string; provider?: string };
    requires_registration?: boolean;
  }>(config, "/api/v1/third-party/wallets", {
    external_user_id: input.externalUserId.trim(),
    phone_number: input.phoneNumber.trim().replace(/^\+/, ""),
    ...(input.firstName?.trim() ? { first_name: input.firstName.trim() } : {}),
    ...(input.lastName?.trim() ? { last_name: input.lastName.trim() } : {}),
    ...(input.dateOfBirth?.trim() ? { date_of_birth: input.dateOfBirth.trim() } : {}),
    ...(input.idNumber?.trim() ? { id_number: input.idNumber.trim() } : {}),
    ...(input.gender?.trim() ? { gender: input.gender.trim() } : {}),
  });
  // A registration demand is an answer, not a failure: the caller collects
  // the ID details from the seller and calls again. It must never be
  // mistaken for a linked wallet.
  if (reply.requires_registration && !reply.wallet?.external_wallet_id) {
    throw new PaymentPayloadError(
      "wallet_registration_required",
      "That number needs SmileCash registration details before it can receive payouts."
    );
  }
  const externalWalletId = reply.wallet?.external_wallet_id ?? "";
  if (!externalWalletId) {
    throw new PaymentProviderRequestError("Linkwa did not return a wallet to pay out to.");
  }
  return { externalWalletId, provider: reply.wallet?.provider ?? "smilecash" };
}

/**
 * Instruct a payout of exact minor units to a verified wallet. Returns
 * Linkwa's payout id for the admin record — the reference a human later
 * reconciles against the statement. No status, no retry, no refund here:
 * undocumented, so refused by omission (see module header).
 */
export async function instructLinkwaPayout(
  config: Pick<LinkwaConfig, "apiKey" | "baseUrl"> & { fetchImpl?: typeof fetch },
  input: LinkwaPayoutInstruction
): Promise<LinkwaPayoutResult> {
  requireLinkwaConfig(config);
  if (input.amountMinor <= 0n) {
    throw new PaymentProviderError("PAYMENT_AMOUNT_INVALID", "A payout amount must be greater than zero.");
  }
  if (!input.externalUserId.trim() || !input.externalWalletId.trim()) {
    throw new PaymentPayloadError("invalid_request", "Instructing a payout needs the linked user and wallet.");
  }
  const whole = input.amountMinor / 100n;
  const fraction = input.amountMinor % 100n;
  const reply = await post<{
    payout?: { payout_id?: string; amount?: unknown; currency?: string };
  }>(config, "/api/v1/third-party/payouts", {
    external_user_id: input.externalUserId.trim(),
    external_wallet_id: input.externalWalletId.trim(),
    amount: Number(`${whole}.${fraction.toString().padStart(2, "0")}`),
    currency_code: "USD",
    include_balance_after: true,
  });
  const payoutId = reply.payout?.payout_id ?? "";
  if (!payoutId) {
    throw new PaymentProviderRequestError("Linkwa did not confirm the payout with an id.");
  }
  const balanceAfter = parseBalanceAfter((reply as { balance_after?: unknown }).balance_after);
  return { payoutId, amountMinor: input.amountMinor, currency: "USD", ...(balanceAfter ? { balanceAfter } : {}) };
}

async function get<T>(
  config: Pick<LinkwaConfig, "apiKey" | "baseUrl"> & { fetchImpl?: typeof fetch },
  path: string
): Promise<T> {
  requireLinkwaConfig(config);
  let response: Response;
  try {
    response = await (config.fetchImpl ?? fetch)(
      `${config.baseUrl.trim().replace(/\/+$/, "")}${path}`,
      { method: "GET", headers: headers(config.apiKey), signal: AbortSignal.timeout(15_000) }
    );
  } catch (err) {
    throw new PaymentProviderRequestError(
      `Could not reach Linkwa: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!response.ok) {
    throw new PaymentProviderRequestError(
      `Linkwa answered HTTP ${response.status} for the balance/statement request.`
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new PaymentProviderRequestError("Linkwa returned a reply we cannot read.");
  }
}

function parseBalanceAfter(value: unknown): LinkwaPayoutResult["balanceAfter"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  try {
    return {
      availableMinor: linkwaAmountToMinor(raw.available_balance),
      pendingMinor: linkwaAmountToMinor(raw.pending_balance ?? 0),
      currency: typeof raw.currency === "string" ? raw.currency : "USD",
    };
  } catch {
    return undefined;
  }
}

/** Available/pending funds across all currencies, in exact minor units. */
export async function fetchLinkwaBalance(
  config: Pick<LinkwaConfig, "apiKey" | "baseUrl"> & { fetchImpl?: typeof fetch }
): Promise<LinkwaBalance[]> {
  const reply = await get<{
    balances?: Array<{ currency?: string; available_balance?: unknown; pending_balance?: unknown }>;
  }>(config, "/api/v1/third-party/balance");
  if (!Array.isArray(reply.balances)) {
    throw new PaymentProviderRequestError("Linkwa did not return a balance list.");
  }
  return reply.balances.map((b) => ({
    currency: typeof b.currency === "string" ? b.currency : "USD",
    availableMinor: linkwaAmountToMinor(b.available_balance),
    pendingMinor: linkwaAmountToMinor(b.pending_balance ?? 0),
  }));
}

/** One page of the documented ledger statement, exact minor units. */
export async function fetchLinkwaStatement(
  config: Pick<LinkwaConfig, "apiKey" | "baseUrl"> & { fetchImpl?: typeof fetch },
  options?: { currencyCode?: string; perPage?: number }
): Promise<LinkwaStatementEntry[]> {
  const params = new URLSearchParams();
  params.set("currency_code", options?.currencyCode ?? "USD");
  params.set("per_page", String(options?.perPage ?? 25));
  const reply = await get<{
    data?: Array<{
      id?: string;
      type?: string;
      currency?: string;
      description?: string;
      amount?: unknown;
      balance_after?: unknown;
      created_date?: string;
      recipient?: { type?: string };
    }>;
  }>(config, `/api/v1/third-party/statement?${params.toString()}`);
  if (!Array.isArray(reply.data)) {
    throw new PaymentProviderRequestError("Linkwa did not return a statement.");
  }
  return reply.data.map((d) => {
    let balanceAfterMinor: bigint | null = null;
    try {
      balanceAfterMinor = d.balance_after === undefined || d.balance_after === null
        ? null
        : linkwaAmountToMinor(d.balance_after);
    } catch {
      balanceAfterMinor = null;
    }
    return {
      id: typeof d.id === "string" ? d.id : "",
      type: typeof d.type === "string" ? d.type : "",
      currency: typeof d.currency === "string" ? d.currency : "USD",
      description: typeof d.description === "string" ? d.description : "",
      amountMinor: linkwaAmountToMinor(d.amount),
      balanceAfterMinor,
      createdAt: typeof d.created_date === "string" ? d.created_date : "",
      recipientType: typeof d.recipient?.type === "string" ? d.recipient.type : null,
    };
  });
}
