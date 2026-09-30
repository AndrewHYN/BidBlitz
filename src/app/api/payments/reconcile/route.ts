import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/server/rate-limit";
import { ensurePaymentProvider, paymentBootError } from "@/server/payments/config";
import {
  PaymentPayloadError,
  PaymentProviderError,
  PaymentProviderNotConfiguredError,
  PaymentProviderRequestError,
  PaymentSignatureError,
} from "@/server/payments/provider";

/**
 * Payment reconciliation — the explicit server-side fallback for the status
 * update that never arrives.
 *
 * The contract, in order of authority:
 *
 *   1. `resulturl` (POST /api/payments/webhook) stays the PRIMARY settlement
 *      signal. Nothing here replaces it, and nothing here claims it works.
 *   2. This route exists because a push that does not arrive must not leave a
 *      sale stuck in AWAITING_PAYMENT. It asks the provider directly, from
 *      the server, using the poll address stored at initiation.
 *   3. The BROWSER never supplies a status. The only thing a request carries
 *      is which transaction to check — a `{ status: "Paid" }` field in the
 *      body is ignored outright, because the buyer is the party with the most
 *      to gain from inventing one.
 *   4. Amount, currency and reference are re-read from Postgres here and
 *      checked again inside the provider and inside `mark_transaction_*`.
 *   5. The answer this route returns is re-read from Postgres AFTER the
 *      provider ran, so the UI converges on what the database says, not on
 *      what Paynow said.
 *
 * Deliberately NOT here: no timer, no queue, no cron. Reconciliation happens
 * only when someone with a stake in the transaction asks for it, rate-limited
 * per caller and per transaction, so a page refresh cannot turn into a
 * high-frequency polling loop against Paynow.
 */

export const dynamic = "force-dynamic";

/** Per caller: enough for a human checking a payment, not for a loop. */
const CALLER_LIMIT = { limit: 6, windowMs: 60_000 };
/** Per transaction: one buyer must not be able to hammer Paynow either. */
const TRANSACTION_LIMIT = { limit: 6, windowMs: 60_000 };

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
    if (reason) console.error("[payments/reconcile]", reason);
    return json({ ok: false, error: "no_payment_provider" }, 503);
  }

  // Bound once, so the call below is a real method invocation and the type
  // system knows the seam exists rather than trusting an assertion.
  const reconcile = provider.reconcile?.bind(provider);
  if (!reconcile) {
    return json({ ok: false, error: "reconciliation_unsupported" }, 501);
  }

  const callerLimit = rateLimit(
    `reconcile:${clientKey(request)}`,
    CALLER_LIMIT.limit,
    CALLER_LIMIT.windowMs
  );
  if (!callerLimit.allowed) {
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

  const transactionLimit = rateLimit(
    `reconcile:tx:${transactionId}`,
    TRANSACTION_LIMIT.limit,
    TRANSACTION_LIMIT.windowMs
  );
  if (!transactionLimit.allowed) {
    return json({ ok: false, error: "rate_limited" }, 429);
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
    .select("id, status, gross_minor, currency, buyer_id, seller_id, auction_id")
    .eq("id", transactionId)
    .maybeSingle();

  if (readError) {
    console.error("[payments/reconcile] read failed", readError.message);
    return json({ ok: false, error: "reconcile_failed" }, 500);
  }
  if (!row) return json({ ok: false, error: "transaction_not_found" }, 404);
  if (row.buyer_id !== user.id && row.seller_id !== user.id) {
    return json({ ok: false, error: "not_a_party" }, 403);
  }

  // The database is the authority on where this transaction stands. A row that
  // is no longer waiting for money is answered from Postgres alone: PAID is
  // never re-opened, FAILED is never flipped by asking again, and no request
  // to Paynow is made at all.
  if (row.status !== "AWAITING_PAYMENT") {
    return json(
      {
        ok: true,
        status: row.status,
        reconciled: false,
        reason: "already_final",
      },
      200
    );
  }

  try {
    const result = await reconcile({
      transactionId: row.id,
      amountMinor: BigInt(row.gross_minor),
      currency: row.currency,
    });

    // Re-read: the truth the buyer and seller see must come from Postgres
    // after the transition, never from the provider's opinion of it.
    const { data: after, error: afterError } = await supabase
      .from("transactions")
      .select("status")
      .eq("id", row.id)
      .maybeSingle();

    if (afterError) {
      console.error("[payments/reconcile] re-read failed", afterError.message);
      return json({ ok: false, error: "reconcile_failed" }, 500);
    }

    // A transition into PAID is a money event the buyer must hear about by
    // email as well as in-app. Keyed on the transaction, so re-polling the
    // same paid sale reuses the row instead of re-mailing. Best-effort: the
    // money already moved; this only announces it.
    if (result.applied && after?.status === "PAID") {
      const { notifyUser } = await import("@/server/email/notify");
      const { emailKey } = await import("@/server/email/sender");
      const { formatMoney, money } = await import("@/lib/money");
      const { data: auctionRow } = await supabase
        .from("auctions")
        .select("id, title")
        .eq("id", (row as { auction_id: string }).auction_id)
        .maybeSingle();
      const auction = auctionRow as { id: string; title: string } | null;
      if (auction) {
        await notifyUser(
          row.buyer_id,
          "payment_received",
          {
            title: auction.title,
            auctionId: auction.id,
            amount: formatMoney(money(row.gross_minor, row.currency)),
          },
          emailKey("payment_received", "transaction", row.id)
        ).catch(() => undefined);
      }
    }

    return json(
      {
        ok: true,
        status: after?.status ?? row.status,
        reconciled: true,
        outcome: result.outcome,
        providerStatus: result.providerStatus,
        changed: result.applied,
      },
      200
    );
  } catch (err) {
    if (err instanceof PaymentSignatureError) {
      return json({ ok: false, error: "invalid_signature" }, 400);
    }
    if (err instanceof PaymentPayloadError) {
      return json({ ok: false, error: err.reason }, 400);
    }
    if (err instanceof PaymentProviderNotConfiguredError) {
      return json({ ok: false, error: "no_payment_provider" }, 503);
    }
    if (err instanceof PaymentProviderRequestError) {
      // Paynow could not be reached, or answered with a failure. Nothing was
      // read, so nothing changed: the transaction stays AWAITING_PAYMENT and
      // the buyer is told exactly that instead of being given a guess.
      console.error("[payments/reconcile] provider unreachable", err.message);
      return json({ ok: false, error: "provider_unreachable" }, 502);
    }
    if (err instanceof PaymentProviderError) {
      console.error("[payments/reconcile] provider failed", err.code);
      return json({ ok: false, error: "provider_error" }, 502);
    }
    // Never log the payload — it may carry buyer details.
    console.error(
      "[payments/reconcile]",
      err instanceof Error ? err.message : String(err)
    );
    return json({ ok: false, error: "reconcile_failed" }, 500);
  }
}
