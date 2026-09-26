/**
 * Payment provider abstraction.
 *
 * Three days is not enough time to build a bank, and pretending to take money
 * would be worse than not taking it. So BidBlitz defines the seam now and
 * ships with `NoopPaymentProvider`: the sale, the fee and the proceeds are all
 * recorded truthfully as AWAITING_PAYMENT, and the UI says so.
 *
 * Swapping in a regional rail (Paynow, mobile money) / card provider /
 * stablecoin settlement means implementing this interface — no auction, fee
 * or transaction code changes. The server side of the seam already exists:
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
 * credentials and documented provider requirements, neither of which exist
 * yet. Do not add one without them.
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

export type ProviderCapabilities = {
  id: string;
  displayName: string;
  /** false => the UI must render an explicit "not configured" state. */
  configured: boolean;
  supportsautomaticCapture: boolean;
  currencies: string[];
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
  confirm(payload: unknown, context?: WebhookContext): Promise<{ handled: boolean }>;
  cancel(transactionId: string): Promise<void>;
}

/**
 * Honest default: nothing is configured, so nothing is claimed.
 * createIntent() throws rather than inventing a successful-looking intent.
 */
export class NoopPaymentProvider implements PaymentProvider {
  readonly capabilities: ProviderCapabilities = {
    id: "none",
    displayName: "No payment provider",
    configured: false,
    supportsautomaticCapture: false,
    currencies: ["USD"],
  };

  async createIntent(): Promise<PaymentIntent> {
    throw new PaymentProviderNotConfiguredError();
  }

  async confirm(
    payload: unknown,
    context?: WebhookContext
  ): Promise<{ handled: boolean }> {
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

export class PaymentProviderNotConfiguredError extends Error {
  readonly code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
  constructor() {
    super(
      "No payment provider is configured. The sale is recorded, but no money has moved."
    );
    this.name = "PaymentProviderNotConfiguredError";
  }
}

let provider: PaymentProvider = new NoopPaymentProvider();

/** Registered at boot; kept tiny so tests can inject a fake. */
export function getPaymentProvider(): PaymentProvider {
  return provider;
}

export function setPaymentProvider(next: PaymentProvider): void {
  provider = next;
}

export function isPaymentConfigured(): boolean {
  return provider.capabilities.configured;
}
