/**
 * Payment provider abstraction.
 *
 * Three days is not enough time to build a bank, and pretending to take money
 * would be worse than not taking it. So BidBlitz defines the seam now and
 * ships with `NoopPaymentProvider`: the sale, the fee and the proceeds are all
 * recorded truthfully as AWAITING_PAYMENT, and the UI says so.
 *
 * Swapping in Stripe / a regional rail / mobile money / stablecoin settlement
 * means implementing this interface — no auction, fee or transaction code
 * changes.
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
  /** Providers call this; it must be safe to invoke repeatedly. */
  confirm(webhookPayload: unknown): Promise<{ handled: boolean }>;
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

  async confirm(): Promise<{ handled: boolean }> {
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
