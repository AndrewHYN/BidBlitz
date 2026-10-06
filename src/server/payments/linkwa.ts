import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
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
 * Linkwa (linkwa.co.zw) — collection + payouts for the Zimbabwe market,
 * implemented against the CURRENT public Developer API contract
 * (linkwa.co.zw/developer-apps/docs and /webhooks/docs, verified in
 * ADR-016). Nothing here is guessed from another provider's shape:
 *
 *   COLLECT    POST {origin}/api/v1/third-party/payment-links (Bearer key)
 *              {amount, currency_code, payment_link_name, return_url, ...}
 *              -> {checkout_url, external_payment_link_id, ...}. The buyer
 *              pays on Linkwa's page; our return_url only lands them home.
 *   STATUS     GET {origin}/api/v1/third-party/payment-links/{short_url}/
 *              payments/{payment_reference}/status -> {status, amount, ...}.
 *              Needs per-attempt identifiers the server only learns from the
 *              webhook or the buyer's return URL, so there is deliberately NO
 *              blind reconcile: the interface leaves it optional and the
 *              route answers `reconciliation_unsupported` honestly.
 *   WEBHOOK    POST payment.completed to our endpoint on success, HMAC-SHA256
 *              hex of the RAW body in `X-Linkwa-Signature`, retries on
 *              non-2xx (10s, 30s, 60s, then every 5 minutes).
 *   PAYOUTS    POST {origin}/api/v1/third-party/payouts
 *              {external_user_id, external_wallet_id, amount, currency_code}.
 *              Recipients link a phone number first (POST /users), then a
 *              SmileCash wallet (POST /wallets); those helpers live in
 *              `linkwa-payouts.ts` and are NOT wired to any UI until the
 *              payout milestone proves them against the sandbox.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   - no reconcile(): the documented status check cannot run without a
 *     short_url + payment_reference the server does not hold. Inventing a
 *     link-level status listing would be guessing at an undocumented
 *     endpoint. Webhook retries are the dependable signal instead.
 *   - no refund path: no refund API is documented. A refunded sale is
 *     recorded only through a provider-signed event if Linkwa ever sends
 *     one; until then refunds stay a manual, audited admin action.
 *   - no idempotency header: none is documented. Our ledger dedupe
 *     (provider, event_id) is the idempotency boundary, exactly as for
 *     Paynow, plus deterministic per-event ids below.
 *   - USD only: the documented examples settle USD and every BidBlitz sale
 *     is denominated in USD. Anything else is refused, not converted.
 */

export const LINKWA_PROVIDER_ID = "linkwa";

/** Linkwa's collection vocabulary, per the developer docs. */
const USD = "USD";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HTTPS_URL_RE = /^https:\/\/[^/\s]+(\/\S*)?$/i;

export type LinkwaConfig = {
  /** Developer API key (`sk_live_...`). Secret. Server only; never logged. */
  apiKey: string;
  /** Account API origin, e.g. the sandbox or production `{origin}` from the
   *  developer dashboard. No default is assumed: the wrong origin would send
   *  money somewhere unobserved, so a missing value stays unconfigured. */
  baseUrl: string;
  /** Webhook signing secret for `X-Linkwa-Signature`. Secret, never logged. */
  webhookSecret: string;
  /** Where Linkwa returns the buyer after checkout. */
  returnUrl: string;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to the Supabase-backed ledger. */
  ledger: PaymentLedger;
};

export function isLinkwaBaseUrl(value: string): boolean {
  return HTTPS_URL_RE.test(value.trim());
}

/**
 * True only when a Linkwa refusal body gives enough evidence to say it was
 * about the minimum amount: the words that name a floor AND the words that
 * say what is floored. Anything less (missing, unreadable, about auth, about
 * signatures, about some other field) stays a generic provider error — we
 * never guess at an undocumented error format.
 */
export function linkwaRefusalIndicatesBelowMinimum(bodyText: string): boolean {
  const text = bodyText.toLowerCase();
  const namesAFloor = /minimum|min\.\s|lower bound/.test(text);
  const aboutAmount = /amount|price|charge|value/.test(text);
  return namesAFloor && aboutAmount;
}

/** Bounded, best-effort read of a refusal body for classification. */
async function readRefusalText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Money — exact decimal strings on the wire, integer minor units inside
// ---------------------------------------------------------------------------

/**
 * Minor units to the wire: an exact two-decimal string. Built from integer
 * arithmetic on the string form, never through float division, so 1999c is
 * "19.99" by construction rather than by floating-point luck.
 */
export function minorToLinkwaAmount(minor: bigint): string {
  if (minor <= 0n) {
    throw new PaymentProviderError(
      "PAYMENT_AMOUNT_INVALID",
      "A Linkwa amount must be greater than zero."
    );
  }
  const whole = minor / 100n;
  const fraction = minor % 100n;
  return `${whole}.${fraction.toString().padStart(2, "0")}`;
}

/**
 * Wire amount back to minor units. Accepts the documented JSON number or a
 * numeric string; anything that is not exactly representable as cents is
 * refused rather than rounded into agreement.
 */
export function linkwaAmountToMinor(amount: unknown): bigint {
  const text =
    typeof amount === "number"
      ? Number.isFinite(amount)
        ? amount.toFixed(2)
        : ""
      : typeof amount === "string"
        ? amount.trim()
        : "";
  if (!/^\d+\.\d{2}$/.test(text)) {
    throw new PaymentPayloadError(
      "amount_mismatch",
      "Linkwa reported an amount we cannot read as exact cents."
    );
  }
  const [whole, fraction] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

// ---------------------------------------------------------------------------
// Webhook authentication — HMAC-SHA256 over the RAW body
// ---------------------------------------------------------------------------

/**
 * Verify the `X-Linkwa-Signature` header before anything in the body is
 * believed. Throws `PaymentSignatureError` — never returns a boolean the
 * caller might forget to check.
 */
export function verifyLinkwaSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): void {
  if (!signature) {
    throw new PaymentSignatureError("The event carried no signature.");
  }
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (left.length !== right.length || left.length === 0) {
    throw new PaymentSignatureError("The event signature did not verify.");
  }
  if (!timingSafeEqual(left, right)) {
    throw new PaymentSignatureError("The event signature did not verify.");
  }
}

/**
 * Stable identity of a Linkwa event. Replays of the same delivery collide on
 * it (audited once); a different attempt or status produces a new one.
 */
export function linkwaEventId(
  externalPaymentLinkId: string,
  attemptReference: string,
  status: string
): string {
  return `linkwa:${externalPaymentLinkId}:${attemptReference}:${status.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export class LinkwaPaymentProvider implements PaymentProvider {
  readonly capabilities: ProviderCapabilities;
  private readonly config: LinkwaConfig;

  constructor(config: LinkwaConfig) {
    if (!config.apiKey || !isLinkwaBaseUrl(config.baseUrl) || !config.webhookSecret) {
      throw new PaymentProviderError(
        "LINKWA_CONFIGURATION_INCOMPLETE",
        "Linkwa needs an API key, an https base URL and a webhook secret."
      );
    }
    this.config = {
      ...config,
      baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    };
    this.capabilities = {
      id: LINKWA_PROVIDER_ID,
      displayName: "Linkwa",
      configured: true,
      currencies: [USD],
      // No server-initiated cancellation or refund endpoint is documented,
      // so neither is offered. See the module header.
      supportsCancellation: false,
    };
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await (this.config.fetchImpl ?? fetch)(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new PaymentProviderRequestError(
        `Could not reach Linkwa: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!response.ok) {
      // Read the body once for classification only: it tells us WHAT failed,
      // and its text is never forwarded to the client verbatim.
      const refusalText = await readRefusalText(response);
      if (linkwaRefusalIndicatesBelowMinimum(refusalText)) {
        throw new PaymentProviderError(
          "PAYMENT_AMOUNT_BELOW_MINIMUM",
          "Linkwa refused the amount as below its published minimum; nothing was charged."
        );
      }
      throw new PaymentProviderRequestError(
        `Linkwa answered HTTP ${response.status} for the payment request.`
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new PaymentProviderRequestError("Linkwa returned a reply we cannot read.");
    }
  }

  async createIntent(input: CreateIntentInput): Promise<PaymentIntent> {
    if (input.currency.trim().toUpperCase() !== USD) {
      throw new PaymentProviderError(
        "PAYMENT_UNSUPPORTED_CURRENCY",
        "Linkwa collection for this integration settles in USD; this sale is denominated in another currency."
      );
    }
    if (!UUID_RE.test(input.transactionId)) {
      // The link must be traceable back to a row we own. Linkwa offers no
      // merchant-reference field, so the trace lives in OUR intent record
      // (external_payment_link_id -> transaction), never in buyer-visible
      // text we cannot trust on the way back.
      throw new PaymentPayloadError(
        "unknown_transaction",
        "The payment reference is not one of our transactions."
      );
    }

    // One live link per sale: the webhook names ONLY Linkwa's external link
    // id, so a second link would be payable money the server could never
    // trace back. Re-entering checkout returns the recorded page instead of
    // minting a sibling. (The row only exists while the sale still awaits
    // payment — a paid sale never reaches intent creation.)
    const existing = await this.config.ledger.readIntent(input.transactionId);
    if (existing) {
      const resumed = this.resumeIntent(input, existing);
      if (resumed) return resumed;
    }

    const reply = await this.post<{
      product?: {
        checkout_url?: string;
        external_payment_link_id?: string;
      };
      checkout_url?: string;
      external_payment_link_id?: string;
    }>("/api/v1/third-party/payment-links", {
      amount: Number(minorToLinkwaAmount(input.amountMinor)),
      currency_code: USD,
      payment_link_name: "BidBlitz auction payment",
      description: `BidBlitz sale ${input.transactionId}`,
      return_url: this.config.returnUrl,
    });

    // The documented shape nests these under `product`; read defensively so
    // a reshaped reply fails loudly instead of redirecting to nowhere.
    const product = reply.product ?? reply;
    const checkoutUrl =
      typeof product.checkout_url === "string" ? product.checkout_url : "";
    const externalId =
      typeof product.external_payment_link_id === "string"
        ? product.external_payment_link_id
        : "";
    if (!checkoutUrl || !externalId) {
      throw new PaymentProviderRequestError("Linkwa did not return a payment page.");
    }

    // Store the session BEFORE the buyer leaves: the external link id is the
    // only key that ties a later webhook back to this transaction, and the
    // webhook is the primary settlement signal. Changes no status.
    await this.config.ledger.recordIntent({
      transactionId: input.transactionId,
      provider: LINKWA_PROVIDER_ID,
      pollUrl: `${this.config.baseUrl}/api/v1/third-party/payment-links/${externalId}`,
      browserUrl: checkoutUrl,
      providerReference: externalId,
    });

    return {
      id: externalId,
      transactionId: input.transactionId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "requires_action",
      redirectUrl: checkoutUrl,
      providerReference: externalId,
    };
  }

  async confirm(payload: unknown, context?: WebhookContext): Promise<ConfirmResult> {
    void payload; // the raw bytes are authoritative; this is only a convenience

    if (!context || context.rawBody.trim() === "") {
      throw new PaymentPayloadError("malformed_payload", "The event had no body.");
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(context.rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      body = parsed as Record<string, unknown>;
    } catch {
      throw new PaymentPayloadError("malformed_payload", "The event was not a Linkwa message.");
    }

    // 1. Authenticate BEFORE parsing anything we might act on.
    verifyLinkwaSignature(
      context.rawBody,
      context.headers["x-linkwa-signature"] ?? null,
      this.config.webhookSecret
    );

    // 2. Only now read the fields. The event names OUR link id, which we
    //    stored at initiation — that id is the join back to our ledger.
    const status = typeof body.status === "string" ? body.status : null;
    const externalId =
      typeof body.external_payment_link_id === "string"
        ? body.external_payment_link_id
        : null;
    if (!status || !externalId) {
      throw new PaymentPayloadError(
        "malformed_payload",
        "The event did not name a payment or a status."
      );
    }

    const transactionId = await this.config.ledger.findTransactionByProviderReference(
      LINKWA_PROVIDER_ID,
      externalId
    );
    if (!transactionId) {
      throw new PaymentPayloadError(
        "unknown_transaction",
        "The event named a payment link we never created."
      );
    }

    if (status.trim().toLowerCase() !== "paid") {
      // Authenticated and recognised, deliberately NOT a state change: the
      // docs publish no other terminal outcome for this event, and inventing
      // one (failed? refunded?) from an undocumented status would be guessing
      // with money. Audited so the trail is complete.
      await this.config.ledger.recordEvent({
        provider: LINKWA_PROVIDER_ID,
        eventId: linkwaEventId(externalId, eventAttempt(body), status),
        transactionId,
        payload: body,
      });
      return { handled: true };
    }

    const currency =
      typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    if (currency !== USD) {
      throw new PaymentPayloadError(
        "currency_mismatch",
        "Linkwa reported a currency this integration does not settle."
      );
    }
    // Amount is re-checked against the recorded sale inside
    // mark_transaction_paid(); parsing here only establishes readability.
    const amountMinor = linkwaAmountToMinor(body.amount);
    await this.config.ledger.markPaid({
      transactionId,
      provider: LINKWA_PROVIDER_ID,
      providerReference:
        typeof body.receipt_id === "string"
          ? body.receipt_id
          : typeof body.reference === "string"
            ? body.reference
            : null,
      amountMinor,
      currency: USD,
      eventId: linkwaEventId(externalId, eventAttempt(body), status),
      payload: body,
    });
    return { handled: true };
  }

  // No reconcile(): the documented status check needs a short_url plus a
  // per-attempt payment_reference that the server only learns from the
  // webhook or the buyer's return URL — neither of which is a trustworthy
  // server-side source for a blind poll. Webhook retries (documented:
  // 10s, 30s, 60s, then every 5 minutes) are the dependable signal instead.
  // The route answers `reconciliation_unsupported` and the UI says so.

  /**
   * Re-enter checkout on a recorded link instead of minting a sibling (see
   * createIntent). Returns null when the record cannot produce a page, so
   * the caller falls through to creating a fresh link.
   */
  private resumeIntent(
    input: CreateIntentInput,
    existing: { browserUrl: string | null; providerReference: string | null }
  ): PaymentIntent | null {
    if (!existing.browserUrl || !existing.providerReference) return null;
    return {
      id: existing.providerReference,
      transactionId: input.transactionId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: "requires_action",
      redirectUrl: existing.browserUrl,
      providerReference: existing.providerReference,
    };
  }

  async cancel(transactionId: string): Promise<void> {
    void transactionId; // named only so the refusal is about the operation
    throw new PaymentUnsupportedOperationError(
      "cancelling a payment (Linkwa documents no server-initiated cancellation endpoint)"
    );
  }
}

/** Per-attempt identity inside one payment link, for the dedupe key. */
function eventAttempt(body: Record<string, unknown>): string {
  for (const key of ["payment_reference", "receipt_id", "reference"]) {
    const value = body[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "-";
}
