import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  PaymentPayloadError,
  PaymentProviderError,
  PaymentProviderRequestError,
  PaymentSignatureError,
  PaymentUnsupportedOperationError,
  type ConfirmResult,
  type CreateIntentInput,
  type PaymentIntent,
  type PaymentProvider,
  type ProviderCapabilities,
  type WebhookContext,
} from "./provider";
import type { PaymentLedger } from "./ledger";

/**
 * Paynow (paynow.co.zw) — the Zimbabwe-first rail, implemented against the
 * CURRENT official Developer Hub contract (developers.paynow.co.zw, verified
 * in ADR-011). Nothing in this file is guessed from an old example: the hash
 * algorithm, the message shapes and the status vocabulary are reproduced from
 * the published pages, and the two published worked examples are asserted
 * byte-for-byte in `paynow.test.ts`.
 *
 * The contract, in full:
 *
 *   INITIATE   POST application/x-www-form-urlencoded
 *              https://www.paynow.co.zw/interface/initiatetransaction
 *              fields: id, reference, amount, returnurl, resulturl, status,
 *              hash  ->  reply is a form string: status/browserurl/pollurl/
 *              paynowreference/hash. Verify the reply hash BEFORE redirecting
 *              the buyer.
 *   CALLBACK   Paynow POSTs a form string to `resulturl`
 *              (our POST /api/payments/webhook): reference, amount,
 *              paynowreference, status, pollurl, hash. Verify the hash FIRST.
 *   HASH       concatenate the message values (URL-decoded, HASH excluded) in
 *              message order, append the Integration Key, SHA-512, uppercase
 *              hex. Confirmed against both published vectors.
 *   STATUSES   Paid / Awaiting Delivery / Delivered  => money is good
 *              Created / Sent                        => in flight, not paid
 *              Cancelled                             => failed
 *              Disputed                              => held, needs a human
 *              Refunded                              => refunded
 *
 * WHAT IS DELIBERATELY NOT HERE (see ADR-011):
 *   - no escrow/marketplace split: Paynow Zimbabwe documents no such API;
 *   - no server-side cancellation: no documented endpoint, so
 *     `cancel()` refuses rather than pretending;
 *   - no payout/disbursement call: Paynow settles to the merchant's own bank
 *     account on its own schedule; BidBlitz does not move seller money.
 */

export const PAYNOW_INITIATE_URL =
  "https://www.paynow.co.zw/interface/initiatetransaction";

/** Provider id recorded on the transaction row. */
export const PAYNOW_PROVIDER_ID = "paynow";

/** Paynow's initiate/confirm messages are USD to two decimal places. */
const USD = "USD";
const CENTS = 100n;

/** Statuses that mean "the customer's money is good". */
const PAID_STATUSES = new Set(["paid", "awaiting delivery", "delivered"]);
/** Statuses that mean the payment did not happen. */
const FAILED_STATUSES = new Set(["cancelled"]);
/** Statuses that mean money went back to the customer. */
const REFUNDED_STATUSES = new Set(["refunded"]);
/** Recognised, audited, and deliberately state-changing: none. */
const NOTED_STATUSES = new Set(["created", "sent", "disputed"]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaynowOutcome = "paid" | "failed" | "refunded" | "noted";

export type PaynowConfig = {
  /** From "Receive Payment Links" -> the integration's Integration ID. */
  integrationId: string;
  /** Secret. Server only; never logged, never sent to the browser. */
  integrationKey: string;
  /** Where Paynow posts status updates: our webhook route. */
  resultUrl: string;
  /** Where the buyer's browser returns to after the Paynow page. */
  returnUrl: string;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to the Supabase-backed ledger. */
  ledger: PaymentLedger;
};

// ---------------------------------------------------------------------------
// Form messages
// ---------------------------------------------------------------------------

/**
 * Parse a Paynow form message into ordered key/value pairs. Order is part of
 * the contract: the hash is computed over the values *in message order*.
 * Values are URL-decoded here, which is exactly what the published hash
 * procedure requires ("URL decode any values first").
 */
export function parsePaynowForm(raw: string): Array<[string, string]> {
  if (raw.trim() === "" || !raw.includes("=")) return [];
  return Array.from(new URLSearchParams(raw.trim()));
}

/** Case-insensitive field read: the docs publish both `Hash` and `hash`. */
export function paynowField(
  fields: Array<[string, string]>,
  name: string
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of fields) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

function isPlausibleMessage(fields: Array<[string, string]>): boolean {
  return (
    fields.length > 0 &&
    fields.some(([key]) => /^[a-z][a-z0-9_]*$/i.test(key))
  );
}

// ---------------------------------------------------------------------------
// Hash — the published procedure, reproducible against Paynow's own examples
// ---------------------------------------------------------------------------

/**
 * Concatenate the message values (HASH excluded) in message order, each in
 * raw decoded form, then append the Integration Key.
 *
 * `.trim()` on each value is not decoration: Paynow's published outbound
 * example contains a leading space inside `returnurl= http://...` yet shows the
 * joined string WITHOUT it, and the resulting hash they publish only
 * reproduces when the value is trimmed (asserted in `paynow.test.ts`). The C#
 * reference sample on the same page trims too.
 */
export function paynowConcatenate(
  fields: Array<[string, string]>,
  integrationKey: string
): string {
  let out = "";
  for (const [key, value] of fields) {
    if (key.toLowerCase() === "hash") continue;
    out += value.trim();
  }
  return out + integrationKey;
}

export function paynowHash(
  fields: Array<[string, string]>,
  integrationKey: string
): string {
  return createHash("sha512")
    .update(paynowConcatenate(fields, integrationKey), "utf8")
    .digest("hex")
    .toUpperCase();
}

/** Length-aware constant-time comparison of two hex digests. */
export function paynowHashMatches(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify an INBOUND message before anything in it is believed.
 * Throws `PaymentSignatureError` — never returns a boolean the caller might
 * forget to check.
 */
export function verifyPaynowHash(
  fields: Array<[string, string]>,
  integrationKey: string
): void {
  const provided = paynowField(fields, "hash");
  if (!provided) {
    throw new PaymentSignatureError("The event carried no hash.");
  }
  if (!paynowHashMatches(paynowHash(fields, integrationKey), provided.toUpperCase())) {
    throw new PaymentSignatureError("The event hash did not verify.");
  }
}

// ---------------------------------------------------------------------------
// Money — integer minor units on our side, two-decimal strings on the wire
// ---------------------------------------------------------------------------

export function paynowAmountToMinor(amount: string): bigint {
  const value = amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new PaymentPayloadError(
      "amount_mismatch",
      `Paynow reported an amount we cannot read as minor units: "${value}".`
    );
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * CENTS + BigInt(fraction.padEnd(2, "0"));
}

export function minorToPaynowAmount(minor: bigint): string {
  if (minor < 0n) {
    throw new PaymentProviderError(
      "PAYMENT_AMOUNT_INVALID",
      "A Paynow amount cannot be negative."
    );
  }
  const whole = minor / CENTS;
  const fraction = minor % CENTS;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

export function paynowOutcome(status: string | null): PaynowOutcome | null {
  if (!status) return null;
  const normalised = status.trim().toLowerCase();
  if (PAID_STATUSES.has(normalised)) return "paid";
  if (FAILED_STATUSES.has(normalised)) return "failed";
  if (REFUNDED_STATUSES.has(normalised)) return "refunded";
  if (NOTED_STATUSES.has(normalised)) return "noted";
  return null;
}

/**
 * Stable identity of a provider event, used as the dedupe key.
 * Replays of the same delivery produce the same id (so the audit log records
 * it once); a genuine later status change produces a different one (so it is
 * processed).
 */
export function paynowEventId(
  reference: string,
  paynowReference: string | null,
  status: string
): string {
  return `paynow:${reference}:${paynowReference ?? "-"}:${status.trim().toLowerCase()}`;
}

function toPayload(fields: Array<[string, string]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fields) out[key.toLowerCase()] = value;
  return out;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export class PaynowPaymentProvider implements PaymentProvider {
  readonly capabilities: ProviderCapabilities;
  private readonly config: PaynowConfig;

  constructor(config: PaynowConfig) {
    if (!config.integrationId || !config.integrationKey) {
      throw new PaymentProviderError(
        "PAYNOW_CONFIGURATION_INCOMPLETE",
        "Paynow needs both an integration id and an integration key."
      );
    }
    this.config = config;
    this.capabilities = {
      id: PAYNOW_PROVIDER_ID,
      displayName: "Paynow",
      configured: true,
      currencies: [USD],
      // Paynow publishes no server-initiated cancellation endpoint, so we
      // never offer one. Documented in ADR-011 as an open question.
      supportsCancellation: false,
    };
  }

  private async send(fields: Array<[string, string]>): Promise<string> {
    const body = new URLSearchParams(fields).toString();
    let response: Response;
    try {
      response = await (this.config.fetchImpl ?? fetch)(PAYNOW_INITIATE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new PaymentProviderRequestError(
        `Could not reach Paynow: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!response.ok) {
      throw new PaymentProviderRequestError(
        `Paynow answered HTTP ${response.status} for the payment request.`
      );
    }
    return response.text();
  }

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    if (input.currency.toUpperCase() !== USD) {
      throw new PaymentProviderError(
        "PAYMENT_UNSUPPORTED_CURRENCY",
        "Paynow settles in USD; this sale is denominated in another currency."
      );
    }
    if (!UUID_RE.test(input.transactionId)) {
      // The reference we send must be OUR id so the callback can be matched
      // back to a row we own; anything else is not ours to charge for.
      throw new PaymentPayloadError(
        "unknown_transaction",
        "The payment reference is not one of our transactions."
      );
    }

    const outbound: Array<[string, string]> = [
      ["id", this.config.integrationId],
      ["reference", input.transactionId],
      ["amount", minorToPaynowAmount(input.amountMinor)],
      ["returnurl", this.config.returnUrl],
      ["resulturl", this.config.resultUrl],
      ["status", "Message"],
    ];
    outbound.push([
      "hash",
      paynowHash(outbound, this.config.integrationKey),
    ]);

    const raw = await this.send(outbound);
    const fields = parsePaynowForm(raw);
    if (!isPlausibleMessage(fields)) {
      throw new PaymentProviderRequestError("Paynow returned an unreadable reply.");
    }

    const status = paynowField(fields, "status") ?? "";
    if (status.toLowerCase() === "error") {
      // Unverified errors carry no hash and are only used to explain a
      // refusal — never to change any state.
      throw new PaymentProviderRequestError(
        `Paynow refused the payment request: ${paynowField(fields, "error") ?? "unknown error"}`
      );
    }

    // Order matters: an "Ok" we cannot authenticate is a forgery, so it is
    // verified before a single field of it is used.
    verifyPaynowHash(fields, this.config.integrationKey);

    const browserUrl = paynowField(fields, "browserurl");
    const pollUrl = paynowField(fields, "pollurl");
    if (status.toLowerCase() !== "ok" || !browserUrl) {
      throw new PaymentProviderRequestError("Paynow did not return a payment page.");
    }

    return {
      id: pollUrl ?? browserUrl,
      transactionId: input.transactionId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "requires_action",
      redirectUrl: browserUrl,
      providerReference: paynowField(fields, "paynowreference") ?? undefined,
    };
  }

  async confirm(payload: unknown, context?: WebhookContext): Promise<ConfirmResult> {
    void payload; // the raw bytes are authoritative; this is only a convenience

    if (!context || context.rawBody.trim() === "") {
      throw new PaymentPayloadError("malformed_payload", "The event had no body.");
    }

    const fields = parsePaynowForm(context.rawBody);
    if (!isPlausibleMessage(fields)) {
      throw new PaymentPayloadError("malformed_payload", "The event was not a Paynow message.");
    }

    // 1. Authenticate BEFORE parsing anything we might act on.
    verifyPaynowHash(fields, this.config.integrationKey);

    // 2. Only now read the fields.
    const status = paynowField(fields, "status");
    const outcome = paynowOutcome(status);
    if (!outcome || !status) return { handled: false };

    const reference = paynowField(fields, "reference");
    if (!reference || !UUID_RE.test(reference)) {
      throw new PaymentPayloadError(
        "unknown_transaction",
        "The event referenced a transaction we do not have."
      );
    }

    const paynowReference = paynowField(fields, "paynowreference");
    const eventId = paynowEventId(reference, paynowReference, status);
    const common = {
      transactionId: reference,
      provider: PAYNOW_PROVIDER_ID,
      eventId,
      payload: toPayload(fields),
    };

    if (outcome === "paid") {
      const amount = paynowField(fields, "amount");
      if (amount === null) {
        throw new PaymentPayloadError("malformed_payload", "The event carried no amount.");
      }
      // Amount and currency are NOT re-checked here: `mark_transaction_paid()`
      // compares them against the recorded sale inside the database, which is
      // the only place that comparison is allowed to live.
      await this.config.ledger.markPaid({
        ...common,
        providerReference: paynowReference,
        amountMinor: paynowAmountToMinor(amount),
        currency: USD,
      });
    } else if (outcome === "failed") {
      await this.config.ledger.markFailed({
        ...common,
        providerReference: paynowReference,
      });
    } else if (outcome === "refunded") {
      await this.config.ledger.markRefunded({ ...common });
    } else {
      // Created / Sent / Disputed: authentic, recognised, and deliberately
      // NOT a state change — a dispute is a human process, not a status we
      // may invent an outcome for. Recorded so the audit log is complete.
      await this.config.ledger.recordEvent({
        provider: PAYNOW_PROVIDER_ID,
        eventId,
        transactionId: reference,
        payload: toPayload(fields),
      });
    }

    return { handled: true };
  }

  async cancel(transactionId: string): Promise<void> {
    void transactionId; // named only so the refusal is about the operation
    throw new PaymentUnsupportedOperationError(
      "cancelling a payment (Paynow publishes no server-initiated cancellation endpoint)"
    );
  }
}
