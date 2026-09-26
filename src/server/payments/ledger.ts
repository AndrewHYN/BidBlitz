import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { PaymentPayloadError, PaymentProviderError } from "./provider";

/**
 * The ledger — the single door between a payment provider and the financial
 * record.
 *
 * WHY THIS EXISTS: every provider must reach `PAID`/`FAILED`/`REFUNDED` the
 * same way, through the same server-authoritative, idempotent, row-locked
 * functions in Postgres. If each provider wrote `transactions` itself, the
 * transition rules would be duplicated in TypeScript — and TypeScript is not
 * where this database decided they live. So providers hold a `PaymentLedger`
 * and this module is the only implementation of it.
 *
 * PRIVILEGE: it uses the privileged server client, which is legitimate here —
 * a webhook acts for no user, RLS cannot express "the provider told us the
 * money arrived", and every write happens inside SECURITY DEFINER functions
 * that re-check the transition, the amount and the currency themselves.
 *
 * FAIL LOUD: any database error that is not one of the known, permanent
 * rejections becomes a generic `PaymentProviderError`, so the webhook route
 * answers 500 and the provider retries. A transient failure must never be
 * silently swallowed into "handled".
 */

export type MarkPaidInput = {
  transactionId: string;
  provider: string;
  /** Provider's own reference for the payment, when it sent one. */
  providerReference: string | null;
  amountMinor: bigint;
  currency: string;
  /** Stable per provider event; replays of the same event collide on it. */
  eventId: string;
  payload?: Record<string, unknown>;
};

export type MarkFailedInput = {
  transactionId: string;
  provider: string;
  providerReference: string | null;
  eventId: string;
  payload?: Record<string, unknown>;
};

export type MarkRefundedInput = {
  transactionId: string;
  provider: string;
  eventId: string;
  payload?: Record<string, unknown>;
};

/** A recognised provider event that changes no transaction state. */
export type RecordEventInput = {
  provider: string;
  eventId: string;
  transactionId: string | null;
  payload?: Record<string, unknown>;
};

export type PaymentLedger = {
  markPaid(input: MarkPaidInput): Promise<{ alreadyPaid: boolean }>;
  markFailed(input: MarkFailedInput): Promise<{ alreadyFailed: boolean }>;
  markRefunded(input: MarkRefundedInput): Promise<{ alreadyRefunded: boolean }>;
  recordEvent(input: RecordEventInput): Promise<void>;
};

/**
 * The database refuses these permanently — retrying will not help, so they
 * surface as rejections (400) instead of failures (500).
 *
 * NOTE: `payment_amount_mismatch` covers BOTH a wrong amount and a wrong
 * currency — `mark_transaction_paid()` raises the same message for either,
 * because both mean "this event is not about this sale".
 */
const PERMANENT = new Map<string, string>([
  ["transaction_not_found", "unknown_transaction"],
  ["payment_invalid_request", "malformed_payload"],
  ["payment_invalid_transition", "invalid_transition"],
  ["payment_amount_mismatch", "amount_mismatch"],
]);

function asReason(error: { message?: string } | null): string | null {
  const message = error?.message ?? "";
  for (const [needle, reason] of PERMANENT) {
    if (message.includes(needle)) return reason;
  }
  return null;
}

function toError(error: { message?: string } | null, what: string): Error {
  const reason = asReason(error);
  if (reason) {
    return new PaymentPayloadError(
      reason,
      `The database refused this payment event: ${reason}.`
    );
  }
  return new PaymentProviderError(
    "PAYMENT_LEDGER_FAILED",
    `${what} failed: ${error?.message ?? "unknown database error"}`
  );
}

/**
 * Money crosses the wire as a number, because `supabase-js` serialises the
 * request body with `JSON.stringify`, which cannot represent `bigint`. This is
 * a wire encoding, NOT arithmetic: every computation stays in integer minor
 * units on both sides, and the guard makes it impossible for a value outside
 * Number.MAX_SAFE_INTEGER to be silently truncated on the way there.
 */
function toWireMinor(minor: bigint): number {
  const asNumber = Number(minor);
  if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== minor) {
    throw new PaymentProviderError(
      "PAYMENT_AMOUNT_OUT_OF_RANGE",
      "Amount cannot be represented safely on the wire."
    );
  }
  return asNumber;
}

function requireCredentials(): void {
  if (!hasAdminCredentials()) {
    throw new PaymentProviderError(
      "PAYMENT_LEDGER_UNAVAILABLE",
      "SUPABASE_SECRET_KEY is not configured, so no payment event can be recorded."
    );
  }
}

export function supabasePaymentLedger(): PaymentLedger {
  return {
    async markPaid(input: MarkPaidInput) {
      requireCredentials();
      const { data, error } = await createAdminClient().rpc("mark_transaction_paid", {
        p_transaction_id: input.transactionId,
        p_provider: input.provider,
        p_provider_reference: input.providerReference,
        p_amount_minor: toWireMinor(input.amountMinor),
        p_currency: input.currency,
        p_event_id: input.eventId,
        p_payload: input.payload ?? {},
      });
      if (error) throw toError(error, "mark_transaction_paid");
      return { alreadyPaid: Boolean((data as { already_paid?: boolean })?.already_paid) };
    },

    async markFailed(input: MarkFailedInput) {
      requireCredentials();
      const { data, error } = await createAdminClient().rpc("mark_transaction_failed", {
        p_transaction_id: input.transactionId,
        p_provider: input.provider,
        p_provider_reference: input.providerReference,
        p_event_id: input.eventId,
        p_payload: input.payload ?? {},
      });
      if (error) throw toError(error, "mark_transaction_failed");
      return { alreadyFailed: Boolean((data as { already_failed?: boolean })?.already_failed) };
    },

    async markRefunded(input: MarkRefundedInput) {
      requireCredentials();
      const { data, error } = await createAdminClient().rpc("mark_transaction_refunded", {
        p_transaction_id: input.transactionId,
        p_provider: input.provider,
        p_event_id: input.eventId,
        p_payload: input.payload ?? {},
      });
      if (error) throw toError(error, "mark_transaction_refunded");
      return {
        alreadyRefunded: Boolean((data as { already_refunded?: boolean })?.already_refunded),
      };
    },

    async recordEvent(input: RecordEventInput) {
      requireCredentials();
      const { error } = await createAdminClient().rpc("record_payment_event", {
        p_provider: input.provider,
        p_event_id: input.eventId,
        p_transaction_id: input.transactionId,
        p_payload: input.payload ?? {},
      });
      if (error) {
        throw toError(error, "record_payment_event");
      }
    },
  };
}
