import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/server/rate-limit";
import { ensurePaymentProvider, paymentBootError } from "@/server/payments/config";
import {
  PaymentPayloadError,
  PaymentProviderError,
  PaymentProviderRequestError,
} from "@/server/payments/provider";

/**
 * Checkout — the buyer half of the transaction flow:
 *
 *   won auction -> view transaction -> review total -> pay -> redirect to the
 *   provider -> provider confirms back through POST /api/payments/webhook.
 *
 * This route only STARTS an intent. It can never mark anything paid: the only
 * transition to PAID is `public.mark_transaction_paid()`, reached from the
 * webhook after the provider's signature has been verified. A successful
 * response here means "a payment page is ready", nothing more — the buyer is
 * redirected to it and the transaction stays AWAITING_PAYMENT until the
 * provider confirms.
 *
 * It answers 503 while no provider is configured, which is the honest state
 * BidBlitz ships in; the UI never renders a pay button that leads here until
 * that changes.
 */

export const dynamic = "force-dynamic";

const CHECKOUT_LIMIT = { limit: 8, windowMs: 60_000 };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : "unknown";
}

export async function POST(request: Request): Promise<Response> {
  const provider = ensurePaymentProvider();

  if (!provider.capabilities.configured) {
    // Configuration failures are a server-side problem: name them in the
    // server log, never in a response the browser renders.
    const reason = paymentBootError();
    if (reason) console.error("[payments/checkout]", reason);
    return json({ ok: false, error: "no_payment_provider" }, 503);
  }

  const limit = rateLimit(
    `checkout:${clientKey(request)}`,
    CHECKOUT_LIMIT.limit,
    CHECKOUT_LIMIT.windowMs
  );
  if (!limit.allowed) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  let transactionId: unknown;
  try {
    const body: unknown = await request.json();
    transactionId =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).transactionId
        : undefined;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if (typeof transactionId !== "string" || !UUID_RE.test(transactionId)) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ ok: false, error: "unauthenticated" }, 401);

  // Read as the caller: RLS already hides rows they are not a party to, so a
  // stranger gets 404 rather than a signal about which ids exist.
  const { data: row, error: readError } = await supabase
    .from("transactions")
    .select("id, status, gross_minor, currency, buyer_id")
    .eq("id", transactionId)
    .maybeSingle();

  if (readError) {
    console.error("[payments/checkout] read failed", readError.message);
    return json({ ok: false, error: "checkout_failed" }, 500);
  }
  if (!row) return json({ ok: false, error: "transaction_not_found" }, 404);
  if (row.buyer_id !== user.id) {
    return json({ ok: false, error: "not_the_buyer" }, 403);
  }
  if (row.status !== "AWAITING_PAYMENT") {
    return json({ ok: false, error: "not_awaiting_payment" }, 409);
  }

  try {
    const intent = await provider.createIntent({
      transactionId: row.id,
      amountMinor: BigInt(row.gross_minor),
      currency: row.currency,
      idempotencyKey: `checkout:${row.id}`,
    });

    if (!intent.redirectUrl) {
      return json({ ok: false, error: "provider_error" }, 502);
    }

    return json(
      {
        ok: true,
        provider: provider.capabilities.id,
        transactionId: row.id,
        redirectUrl: intent.redirectUrl,
      },
      200
    );
  } catch (err) {
    if (err instanceof PaymentPayloadError) {
      return json({ ok: false, error: err.reason }, 400);
    }
    if (err instanceof PaymentProviderRequestError) {
      console.error("[payments/checkout] provider refused", err.message);
      return json({ ok: false, error: "provider_error" }, 502);
    }
    if (err instanceof PaymentProviderError) {
      const unsupported = err.code === "PAYMENT_UNSUPPORTED_CURRENCY";
      return json(
        { ok: false, error: unsupported ? "unsupported_currency" : "provider_error" },
        unsupported ? 400 : 502
      );
    }
    console.error(
      "[payments/checkout]",
      err instanceof Error ? err.message : String(err)
    );
    return json({ ok: false, error: "checkout_failed" }, 500);
  }
}
