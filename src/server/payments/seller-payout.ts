import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { readLinkwaEnvironment } from "@/server/payments/config";
import {
  fetchLinkwaBalance,
  instructLinkwaPayout,
} from "@/server/payments/linkwa-payouts";
import { paymentsRuntimeEnabled } from "@/server/payments/runtime";

export type SellerPayoutReleaseResult =
  | { ok: true; status: "PAID_OUT"; payoutReference: string }
  | {
      ok: false;
      code:
        | "payments_paused"
        | "not_ready"
        | "recipient_not_ready"
        | "provider_not_ready"
        | "provider_failed"
        | "provider_funds_pending"
        | "manual_reconciliation_required";
      message: string;
    };

async function transition(
  payoutId: string,
  status: string,
  payoutReference?: string | null,
  note?: string | null
) {
  return createAdminClient().rpc("service_transition_seller_payout", {
    p_payout_id: payoutId,
    p_to_status: status,
    p_payout_reference: payoutReference ?? null,
    p_internal_note: note ?? null,
  });
}

export async function releaseSellerPayout(
  payoutId: string
): Promise<SellerPayoutReleaseResult> {
  if (!(await paymentsRuntimeEnabled())) {
    return {
      ok: false,
      code: "payments_paused",
      message: "Payments are temporarily paused. No seller payout was sent.",
    };
  }

  const admin = createAdminClient();
  const { data: payout, error: payoutError } = await admin
    .from("seller_payouts")
    .select(
      "id, transaction_id, seller_id, amount_minor, currency, status, payout_reference, delivery_confirmed_at"
    )
    .eq("id", payoutId)
    .maybeSingle();

  if (payoutError || !payout) {
    return { ok: false, code: "not_ready", message: "That payout is unavailable." };
  }

  if (payout.status === "PAID_OUT") {
    return {
      ok: true,
      status: "PAID_OUT",
      payoutReference: payout.payout_reference ?? "recorded",
    };
  }

  // Defence in depth: an unresolved transaction dispute blocks money movement
  // independently of the payout-status transition. The dispute-opening RPC
  // normally moves a safely reversible payout to DISPUTED, but release must
  // never rely on that single state write to protect the parties.
  const { data: openDispute, error: disputeError } = await admin
    .from("transaction_disputes")
    .select("id")
    .eq("transaction_id", payout.transaction_id)
    .neq("status", "RESOLVED")
    .limit(1)
    .maybeSingle();

  if (disputeError) {
    return {
      ok: false,
      code: "manual_reconciliation_required",
      message: "BidBlitz could not verify the dispute state, so no payout was sent.",
    };
  }
  if (openDispute) {
    return {
      ok: false,
      code: "not_ready",
      message: "This transaction has an unresolved dispute. Seller payout remains blocked.",
    };
  }

  // PAYOUT_DUE means the provider instruction may already have happened but
  // the final ledger write may have failed. Never auto-retry that state.
  const { data: priorEvents, error: eventsError } = await admin
    .from("seller_payout_events")
    .select("to_status, payout_reference")
    .eq("payout_id", payout.id);
  if (eventsError) {
    return {
      ok: false,
      code: "manual_reconciliation_required",
      message: "BidBlitz could not verify the payout audit trail, so nothing was sent.",
    };
  }
  if (
    (priorEvents ?? []).some(
      (event) =>
        event.to_status === "PAID_OUT" ||
        Boolean(event.payout_reference?.trim())
    )
  ) {
    return {
      ok: false,
      code: "manual_reconciliation_required",
      message: "A provider payout is already recorded for this sale. Do not send another.",
    };
  }

  if (payout.status === "PAYOUT_DUE") {
    return {
      ok: false,
      code: "manual_reconciliation_required",
      message:
        "This payout may already have reached the provider. Reconcile it before any retry.",
    };
  }

  if (
    !payout.delivery_confirmed_at ||
    !["DELIVERY_CONFIRMED", "PAYOUT_PENDING"].includes(payout.status)
  ) {
    return {
      ok: false,
      code: "not_ready",
      message: "The buyer must confirm handover before the seller can be paid.",
    };
  }

  const { data: tx } = await admin
    .from("transactions")
    .select("status")
    .eq("id", payout.transaction_id)
    .maybeSingle();
  if (!tx || !["PAID", "SETTLED"].includes(tx.status)) {
    return {
      ok: false,
      code: "not_ready",
      message: "The buyer payment is not in a payable state.",
    };
  }

  const { data: recipient } = await admin
    .from("seller_payout_recipients")
    .select(
      "setup_status, external_user_id, external_wallet_id, wallet_provider"
    )
    .eq("seller_id", payout.seller_id)
    .maybeSingle();

  if (
    !recipient ||
    recipient.setup_status !== "READY" ||
    !recipient.external_user_id ||
    !recipient.external_wallet_id
  ) {
    await admin.from("notifications").insert({
      user_id: payout.seller_id,
      type: "PAYOUT_SETUP_REQUIRED",
      payload: { payoutId: payout.id },
    });
    return {
      ok: false,
      code: "recipient_not_ready",
      message: "The seller needs to finish payout setup before money can be sent.",
    };
  }

  if (payout.currency !== "USD" || payout.amount_minor <= 0) {
    return { ok: false, code: "not_ready", message: "This payout amount is not valid." };
  }

  const linkwa = readLinkwaEnvironment();
  if (linkwa.state !== "ready" || !linkwa.config) {
    return {
      ok: false,
      code: "provider_not_ready",
      message: "Linkwa payout configuration is incomplete.",
    };
  }

  if (payout.status === "DELIVERY_CONFIRMED") {
    const pending = await transition(
      payout.id,
      "PAYOUT_PENDING",
      null,
      "Automatic release started after buyer-confirmed handover."
    );
    if (pending.error) {
      return { ok: false, code: "not_ready", message: "The payout could not be prepared." };
    }
  }

  // Mobile-wallet collections can settle quickly while card collections may
  // remain pending for several working days. Never claim a payout for sending
  // until Linkwa's AVAILABLE USD balance can cover the seller's frozen net.
  try {
    const balances = await fetchLinkwaBalance({
      apiKey: linkwa.config.apiKey,
      baseUrl: linkwa.config.baseUrl,
    });
    const usd = balances.find((balance) => balance.currency === "USD");
    if (!usd || usd.availableMinor < BigInt(payout.amount_minor)) {
      return {
        ok: false,
        code: "provider_funds_pending",
        message:
          "The seller payout is ready, but Linkwa has not made enough settlement balance available yet.",
      };
    }
  } catch {
    return {
      ok: false,
      code: "provider_failed",
      message:
        "BidBlitz could not verify the available Linkwa balance, so no payout was sent.",
    };
  }

  // Atomic state claim before the network call. Only one caller can move
  // PAYOUT_PENDING -> PAYOUT_DUE. A retry after that refuses above.
  const due = await transition(
    payout.id,
    "PAYOUT_DUE",
    null,
    "Claimed for automatic Linkwa payout."
  );
  if (due.error) {
    return {
      ok: false,
      code: "manual_reconciliation_required",
      message: "The payout changed state before release. Reload before retrying.",
    };
  }

  try {
    const result = await instructLinkwaPayout(
      {
        apiKey: linkwa.config.apiKey,
        baseUrl: linkwa.config.baseUrl,
      },
      {
        externalUserId: recipient.external_user_id,
        externalWalletId: recipient.external_wallet_id,
        amountMinor: BigInt(payout.amount_minor),
      }
    );

    const recorded = await transition(
      payout.id,
      "PAID_OUT",
      result.payoutId,
      `Automatic Linkwa payout instructed after buyer-confirmed handover: ${result.payoutId}.`
    );

    if (recorded.error) {
      return {
        ok: false,
        code: "manual_reconciliation_required",
        message:
          "Linkwa accepted the payout but BidBlitz could not finish recording it. Do not retry automatically.",
      };
    }

    await admin.from("notifications").insert({
      user_id: payout.seller_id,
      type: "PAYOUT_SENT",
      payload: {
        payoutId: payout.id,
        amountMinor: payout.amount_minor,
        currency: payout.currency,
        wallet: recipient.wallet_provider ?? "smilecash",
      },
    });

    return { ok: true, status: "PAID_OUT", payoutReference: result.payoutId };
  } catch (error) {
    // Once PAYOUT_DUE was claimed we do not auto-return to a retryable money
    // state: an ambiguous provider failure could still have moved funds.
    await admin.from("notifications").insert({
      user_id: payout.seller_id,
      type: "PAYOUT_ATTENTION",
      payload: { payoutId: payout.id },
    });
    return {
      ok: false,
      code: "provider_failed",
      message:
        error instanceof Error
          ? "The payout provider did not complete cleanly. BidBlitz will reconcile it before retrying."
          : "The payout provider needs reconciliation before retrying.",
    };
  }
}
