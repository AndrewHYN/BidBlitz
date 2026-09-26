import {
  PaymentPayloadError,
  PaymentProviderNotConfiguredError,
  PaymentSignatureError,
} from "@/server/payments/provider";
import { ensurePaymentProvider } from "@/server/payments/config";
import { precheckWebhookBody } from "@/server/payments/webhook-body";

/**
 * Payment webhook endpoint — the receiving half of the provider seam.
 *
 * Design notes:
 *  - RAW BODY: the untouched text is handed to `confirm()` so a provider can
 *    hash exactly the bytes it signed. This route only pre-checks the shape of
 *    the body; authentication is the provider's job and it happens before any
 *    state change, inside `PaymentProvider.confirm()`.
 *  - BOTH ENCODINGS: Paynow posts `application/x-www-form-urlencoded`; other
 *    providers post JSON. The pre-check accepts either and names precisely
 *    which one it could not read, instead of pretending every body is JSON.
 *  - HONEST 503: with no provider configured this endpoint answers
 *    "no_payment_provider" rather than pretending to accept events. It never
 *    fabricates a success and it never touches a transaction itself.
 *  - IDEMPOTENCY + audit live in `public.mark_transaction_paid()` (row lock,
 *    amount/currency verification, payment_events dedupe, explicit
 *    AWAITING_PAYMENT -> PAID transition). A provider's confirm() calls it
 *    only after verifying the signature — auction/fee code stays put.
 *  - RESPONSE CODES: 200 handled, 400 the event was rejected for a permanent,
 *    named reason (the provider will retry up to its own limit and every
 *    retry is safe by construction), 503 not configured, 500 unexpected
 *    failure (retryable).
 *
 * Note on retries: Paynow resends a status update up to ten times when the
 * response is an HTTP error status. 400 and 500 therefore both cause a
 * bounded retry; they differ in meaning (permanent rejection vs. try again),
 * not in whether the handler is safe to re-enter.
 */

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const provider = ensurePaymentProvider();

  if (!provider.capabilities.configured) {
    return json({ ok: false, error: "no_payment_provider" }, 503);
  }

  const rawBody = await request.text();
  const checked = precheckWebhookBody(rawBody);
  if (!checked.ok) {
    return json({ ok: false, error: checked.error }, 400);
  }

  try {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const result = await provider.confirm(checked.payload, { rawBody, headers });
    if (!result.handled) {
      return json({ ok: false, error: "unrecognized_payload" }, 400);
    }
    return json({ ok: true }, 200);
  } catch (err) {
    // Rejections are reported precisely (they name the rule that fired, never
    // a secret); anything else is logged WITHOUT the payload — it may carry
    // buyer details — and answered 500 so the provider retries.
    if (err instanceof PaymentSignatureError) {
      return json({ ok: false, error: "invalid_signature" }, 400);
    }
    if (err instanceof PaymentPayloadError) {
      return json({ ok: false, error: err.reason }, 400);
    }
    if (err instanceof PaymentProviderNotConfiguredError) {
      return json({ ok: false, error: "no_payment_provider" }, 503);
    }
    console.error(
      "[payments/webhook]",
      err instanceof Error ? err.message : String(err)
    );
    return json({ ok: false, error: "webhook_failed" }, 500);
  }
}
