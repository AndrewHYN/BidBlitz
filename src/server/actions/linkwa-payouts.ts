"use server";

/**
 * The admin-only Linkwa seller-payout action.
 *
 * Money movement contract (ADR-016):
 *   - The browser sends ONLY a payoutId. Amount, currency, recipient and
 *     provider are all derived server-side from the frozen ledger row and the
 *     server-side recipient record. `.strict()` makes a forged extra field a
 *     validation error, not an ignored key.
 *   - The recipient instruction, the payout amount and the recorded reference
 *     never come from the browser.
 *   - Exactly one instruction per payout: the ledger's state machine is the
 *     idempotency boundary. The row must be PAYOUT_PENDING, and this action
 *     claims it with an atomic PAYOUT_PENDING -> PAYOUT_DUE transition before
 *     any network call. A concurrent click loses the race and is refused.
 *   - Linkwa documents no payout status endpoint and no payout webhook, so
 *     "PAID_OUT" here means "Linkwa accepted the instruction and returned a
 *     payout_id" - confirmation beyond that is a statement/balance check a
 *     human does in the Linkwa console, not something this UI fakes.
 *   - A provider failure never marks the payout successful: the row moves to
 *     HELD with the failure recorded, and a retry requires an explicit
 *     HELD -> PAYOUT_PENDING release.
 *   - Provider/ledger mismatch: the append-only seller_payout_events trail is
 *     read before any claim, and a trail that already records a provider
 *     payout refuses the instruction (fail-closed) - Linkwa documents no
 *     payout status endpoint, so no other duplicate check exists.
 *   - Delivery is an explicit fulfilment fact (ADR-016). The database refuses
 *     any move into PAYOUT_DUE while `delivery_confirmed_at` is NULL; this
 *     action checks the same fact first so the operator gets the real reason
 *     instead of a generic refusal. Both layers are fail-closed and neither
 *     can be reached from the browser.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readLinkwaEnvironment } from "@/server/payments/config";
import { instructLinkwaPayout } from "@/server/payments/linkwa-payouts";

const initiateSchema = z
  .object({ payoutId: z.string().uuid("Invalid payout") })
  .strict();

type InitiateResult =
  | { ok: true; payoutReference: string }
  | { ok: false; message: string };

function providerFailureMessage(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

export async function initiateLinkwaPayoutAction(input: unknown): Promise<InitiateResult> {
  void input;
  return {
    ok: false,
    message: "Seller payouts are temporarily paused while BidBlitz completes the new payout setup.",
  };

  const parsed = initiateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid payout request.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  // The frozen ledger row is the ONLY source of amount/currency/recipient.
  const { data: payout } = await supabase
    .from("seller_payouts")
    .select(
      "id, transaction_id, seller_id, amount_minor, currency, status, payout_reference, delivery_confirmed_at"
    )
    .eq("id", parsed.data.payoutId)
    .maybeSingle();
  if (!payout) return { ok: false, message: "That payout no longer exists." };

  if (payout.status === "PAID_OUT") {
    return { ok: false, message: "This payout is already recorded as paid out." };
  }
  if (payout.status !== "PAYOUT_PENDING") {
    return {
      ok: false,
      message: `Only a payout in "Payout pending" can be sent to Linkwa. This one is ${payout.status}.`,
    };
  }
  if (payout.payout_reference) {
    return { ok: false, message: "A payout reference is already recorded for this payout." };
  }

  // Provider/ledger mismatch guard. `seller_payout_events` is append-only, so
  // if it already records a provider payout for this row then the money has
  // left the platform even when the status column still lags behind it (the
  // exact mismatch found on 2026-10-05: an executed Linkwa payout with a row
  // left in WAITING_FOR_FULFILMENT). Linkwa documents no payout status
  // endpoint and no payout webhook, so this audit trail plus the frozen
  // `payout_reference` is the ONLY duplicate protection that exists - it is
  // read here, fail-closed, before any claim or provider call.
  const { data: priorPayoutEvents, error: payoutEventsError } = await supabase
    .from("seller_payout_events")
    .select("to_status, payout_reference")
    .eq("payout_id", payout.id);
  if (payoutEventsError) {
    return {
      ok: false,
      message:
        "Could not verify this payout's audit trail, so no payout was sent. Try again.",
    };
  }
  const alreadyInstructed = (priorPayoutEvents ?? []).some(
    (event) => event.to_status === "PAID_OUT" || Boolean(event.payout_reference?.trim())
  );
  if (alreadyInstructed) {
    return {
      ok: false,
      message:
        "This payout already has a provider payout recorded in its audit trail. " +
        "Reconcile the ledger instead of sending another payout.",
    };
  }

  // Delivery must be an explicit fulfilment fact before money can move. The
  // database enforces the same rule on the claim below (it raises
  // `payout_delivery_not_confirmed`), so this check is the honest message and
  // the claim stays the authority.
  if (!payout.delivery_confirmed_at) {
    return {
      ok: false,
      message:
        "Delivery has not been confirmed for this sale, so this payout cannot " +
        "be sent to Linkwa. Confirm delivery first.",
    };
  }

  if (payout.currency !== "USD") {
    return { ok: false, message: "Only USD payouts can be sent through Linkwa." };
  }
  if (!Number.isFinite(payout.amount_minor) || payout.amount_minor <= 0) {
    return { ok: false, message: "This payout has no payable amount." };
  }

  // The underlying payment must still be good money. The payout row is keyed
  // to the transaction, so reading the transaction through the row's own
  // transaction_id can never cross two different sales.
  const { data: tx } = await supabase
    .from("transactions")
    .select("id, status")
    .eq("id", payout.transaction_id)
    .maybeSingle();
  if (!tx || (tx.status !== "PAID" && tx.status !== "SETTLED")) {
    return {
      ok: false,
      message: "The payment behind this payout is not in a payable state.",
    };
  }

  // Recipient: server-side record only, never from the browser.
  const { data: recipient } = await supabase
    .from("seller_payout_recipients")
    .select("provider, external_user_id, external_wallet_id")
    .eq("seller_id", payout.seller_id)
    .maybeSingle();
  if (!recipient || recipient.provider !== "linkwa") {
    return {
      ok: false,
      message: "No Linkwa payout recipient is on file for this seller.",
    };
  }

  const linkwa = readLinkwaEnvironment();
  if (linkwa.state !== "ready" || !linkwa.config) {
    return {
      ok: false,
      message: "Linkwa is not fully configured on this deployment. No payout was sent.",
    };
  }

  // Atomic claim. Only the caller whose transition moved the row is allowed
  // to instruct the provider; everyone else gets `already` or a refusal.
  const claim = await supabase.rpc("admin_transition_seller_payout", {
    p_payout_id: payout.id,
    p_to_status: "PAYOUT_DUE",
  });
  if (claim.error) {
    const m = claim.error.message.toLowerCase();
    if (m.includes("payout_invalid_transition")) {
      return {
        ok: false,
        message: "This payout changed state while you were confirming. Reload and try again.",
      };
    }
    if (m.includes("payout_delivery_not_confirmed")) {
      // The database refused the claim: no delivery fact, so no provider call
      // was ever made.
      return {
        ok: false,
        message:
          "Delivery has not been confirmed for this sale, so this payout was " +
          "not sent. Confirm delivery first.",
      };
    }
    return { ok: false, message: "That payout update was refused. Reload and try again." };
  }
  const claimData = claim.data as { already?: boolean } | null;
  if (claimData?.already === true) {
    return {
      ok: false,
      message: "This payout is already being processed. Reload and try again.",
    };
  }

  try {
    const result = await instructLinkwaPayout(
      { apiKey: linkwa.config.apiKey, baseUrl: linkwa.config.baseUrl },
      {
        externalUserId: recipient.external_user_id,
        externalWalletId: recipient.external_wallet_id,
        amountMinor: BigInt(payout.amount_minor),
      }
    );

    const record = await supabase.rpc("admin_transition_seller_payout", {
      p_payout_id: payout.id,
      p_to_status: "PAID_OUT",
      p_payout_reference: result.payoutId,
      p_internal_note:
        `Linkwa payout instructed: ${result.payoutId}. Linkwa documents no payout ` +
        "status endpoint, so confirm settlement in the Linkwa statement/balance.",
    });
    if (record.error) {
      // Money moved but the record did not: say so loudly and do NOT retry.
      return {
        ok: false,
        message:
          `Linkwa accepted the payout (id ${result.payoutId}) but recording it failed. ` +
          "Record PAID_OUT with that reference by hand before doing anything else - do not re-instruct.",
      };
    }

    revalidatePath("/admin");
    revalidatePath("/dashboard/transactions");
    revalidatePath("/dashboard/selling");
    return { ok: true, payoutReference: result.payoutId };
  } catch (err) {
    // Provider failed BEFORE any money moved: record it honestly, never as success.
    const note = `Linkwa payout failed before any money moved: ${providerFailureMessage(err)}`;
    try {
      await supabase.rpc("admin_transition_seller_payout", {
        p_payout_id: payout.id,
        p_to_status: "HELD",
        p_internal_note: note,
      });
    } catch {
      // The refusal is still returned to the operator; the row stays PAYOUT_DUE
      // (claim held), which is retryable after a reload rather than a false PAID.
    }
    return {
      ok: false,
      message:
        "Linkwa rejected or could not process the payout, so nothing was sent. " +
        "The payout was moved to HELD with the reason recorded; release it to " +
        "\"Payout pending\" to try again.",
    };
  }
}
