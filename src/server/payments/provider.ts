/**
 * Payment provider abstraction — the ONLY seam between BidBlitz and money.
 *
 * Three days is not enough time to build a bank, and pretending to take money
 * would be worse than not taking it. So BidBlitz defines the seam now and
 * ships with `NoopPaymentProvider`: the sale, the fee and the proceeds are all
 * recorded truthfully as AWAITING_PAYMENT, and the UI says so.
 *
 * Swapping in a regional rail (Paynow — see ADR-011) / card provider /
 * stablecoin settlement means implementing this interface. The auction, fee
 * and transaction domain must never name a provider, so:
 *
 *   - nothing in this file imports a provider implementation;
 *   - `src/server/payments/config.ts` is the ONE place that reads credentials
 *     and decides which implementation is registered (Noop unless a complete,
 *     valid configuration exists);
 *   - `src/server/payments/ledger.ts` is the ONE place that writes payment
 *     state to the database, so every provider funnels through the same
 *     idempotent, auditable transitions.
 *
 * The server side of the seam already exists:
 *
 *   POST /api/payments/webhook  ->  provider.confirm(payload, { rawBody,
 *                                   headers })  ->  signature verified by the
 *                                   provider implementation  ->  public.
 *                                   mark_transaction_paid() (row-locked,
 *                                   amount-verified, event-deduplicated via
 *                                   payment_events, AWAITING_PAYMENT -> PAID
 *                                   only, auditable, safe to retry).
 *
 * Nothing here activates a provider: that requires verified merchant
 * credentials. Do not add a provider implementation without documenting the
 * official contract it implements (ADR-011).
 */

export type PaymentIntentStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PaymentIntent = {
  id: string;
  transactionId: string;
  amountMinor: bigint;
  currency: string;
  status: PaymentIntentStatus;
  /** Where the buyer should be sent to finish, if anywhere. */
  redirectUrl?: string;
  providerReference?: string;
};

export type CreateIntentInput = {
  transactionId: string;
  amountMinor: bigint;
  currency: string;
  /** Provided for providers that need an idempotency key. */
  idempotencyKey: string;
};

/**
 * Everything a provider needs to VERIFY a webhook, not merely parse it.
 * Signature schemes hash the exact bytes received (and read specific headers),
 * so `rawBody` is the untouched request body — never a re-serialized object.
 */
export type WebhookContext = {
  rawBody: string;
  headers: Record<string, string>;
};

/**
 * `handled: true`  => the event was recognised, verified and accounted for
 *                     (it may deliberately have changed no state — a
 *                     "still in flight" status is still a handled event).
 * `handled: false` => not an event for us; the caller should reject it
 *                     without retrying.
 *
 * A provider signals a REJECTED event by throwing a `PaymentPayloadError`
 * (bad signature, unknown transaction, wrong amount) rather than by returning
 * `handled: false`, so the caller can report the exact reason.
 */
export type ConfirmResult = { handled: boolean };

export type ProviderCapabilities = {
  id: string;
  displayName: string;
  /** false => the UI must render an explicit "not configured" state. */
  configured: boolean;
  currencies: string[];
  /** True ONLY when the provider documents a server-initiated cancel API. */
  supportsCancellation: boolean;
};

export interface PaymentProvider {
  readonly capabilities: ProviderCapabilities;
  createIntent(input: CreateIntentInput): Promise<PaymentIntent>;
  /**
   * Providers call this; it must be safe to invoke repeatedly (retries are
   * normal). Verify `context.rawBody` against the provider's signature BEFORE
   * trusting `payload`, then persist through `mark_transaction_paid()` — the
   * dedupe, amount check and transition guard live there, not here.
   */
  confirm(payload: unknown, context?: WebhookContext): Promise<ConfirmResult>;
  cancel(transactionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors — a closed vocabulary the HTTP layer maps to responses. Codes are
// stable strings so callers never have to parse a message.
// ---------------------------------------------------------------------------

export class PaymentProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentProviderError";
    this.code = code;
  }
}

export class PaymentProviderNotConfiguredError extends PaymentProviderError {
  constructor() {
    super(
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
      "No payment provider is configured. The sale is recorded, but no money has moved."
    );
    this.name = "PaymentProviderNotConfiguredError";
  }
}

/** The message did not authenticate. Nothing from it was acted on. */
export class PaymentSignatureError extends PaymentProviderError {
  constructor(message = "The event signature could not be verified.") {
    super("PAYMENT_SIGNATURE_INVALID", message);
    this.name = "PaymentSignatureError";
  }
}

/**
 * A well-signed event that is still not acceptable — unknown transaction,
 * wrong amount, unparseable field. `reason` is safe to surface: it names the
 * rule that rejected the event, never a secret.
 */
export class PaymentPayloadError extends PaymentProviderError {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super("PAYMENT_PAYLOAD_INVALID", message);
    this.name = "PaymentPayloadError";
    this.reason = reason;
  }
}

/** The provider's own API refused or failed the request (initiate, poll). */
export class PaymentProviderRequestError extends PaymentProviderError {
  constructor(message: string) {
    super("PAYMENT_PROVIDER_REQUEST_FAILED", message);
    this.name = "PaymentProviderRequestError";
  }
}

/** The provider does not offer this operation — never stub it as a no-op. */
export class PaymentUnsupportedOperationError extends PaymentProviderError {
  constructor(operation: string) {
    super(
      "PAYMENT_UNSUPPORTED_OPERATION",
      `This payment provider does not support ${operation}.`
    );
    this.name = "PaymentUnsupportedOperationError";
  }
}

// ---------------------------------------------------------------------------
// Honest default: nothing is configured, so nothing is claimed.
// createIntent() throws rather than inventing a successful-looking intent.
// ---------------------------------------------------------------------------

export class NoopPaymentProvider implements PaymentProvider {
  readonly capabilities: ProviderCapabilities = {
    id: "none",
    displayName: "No payment provider",
    configured: false,
    currencies: ["USD"],
    supportsCancellation: false,
  };

  async createIntent(): Promise<PaymentIntent> {
    throw new PaymentProviderNotConfiguredError();
  }

  async confirm(
    payload: unknown,
    context?: WebhookContext
  ): Promise<ConfirmResult> {
    // Nothing is configured, so nothing is claimed: an unconfigured endpoint
    // must never look like it processed an event — the payload and its
    // signature context are accepted only so callers can always pass them.
    void payload;
    void context;
    return { handled: false };
  }

  async cancel(): Promise<void> {
    /* nothing to cancel: no intent was ever created */
  }
}

// ---------------------------------------------------------------------------
// Registry. `config.ts` registers at boot; kept tiny so tests can inject.
// ---------------------------------------------------------------------------

let provider: PaymentProvider = new NoopPaymentProvider();

export function getPaymentProvider(): PaymentProvider {
  return provider;
}

export function setPaymentProvider(next: PaymentProvider): void {
  provider = next;
}

export function isPaymentConfigured(): boolean {
  return provider.capabilities.configured;
}
