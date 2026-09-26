import { getPaymentProvider, isPaymentConfigured } from "@/server/payments/provider";

/**
 * Payment webhook endpoint — the receiving half of the provider seam.
 *
 * Design notes:
 *  - RAW BODY: the untouched text is handed to `confirm()` so a provider can
 *    hash exactly the bytes it signed; parsing happens only after that call
 *    site decides to trust the payload (the provider implementation parses).
 *    Here we parse just enough to reject obvious garbage with 400.
 *  - HONEST 503: no provider is configured today, so this endpoint answers
 *    "no_payment_provider" rather than pretending to accept events. It never
 *    fabricates a success and it never touches a transaction itself.
 *  - IDEMPOTENCY + audit live in `public.mark_transaction_paid()` (row lock,
 *    amount/currency verification, payment_events dedupe, explicit
 *    AWAITING_PAYMENT -> PAID transition). A future provider's confirm()
 *    calls it after verifying the signature — auction/fee code stays put.
 *  - RESPONSE CODES: 200 handled, 400 unparseable/unrecognized (the provider
 *    should not retry blind), 503 not configured, 500 unexpected failure
 *    (provider may retry; retries are safe by construction).
 */

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isPaymentConfigured()) {
    return json({ ok: false, error: "no_payment_provider" }, 503);
  }

  const rawBody = await request.text();
  if (rawBody.trim() === "") {
    return json({ ok: false, error: "empty_body" }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const result = await getPaymentProvider().confirm(payload, { rawBody, headers });
    if (!result.handled) {
      return json({ ok: false, error: "unrecognized_payload" }, 400);
    }
    return json({ ok: true }, 200);
  } catch (err) {
    // Log the failure only — never the payload (it may carry buyer details).
    console.error(
      "[payments/webhook]",
      err instanceof Error ? err.message : String(err)
    );
    return json({ ok: false, error: "webhook_failed" }, 500);
  }
}
