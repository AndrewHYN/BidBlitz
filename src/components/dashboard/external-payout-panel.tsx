"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ClipboardCheck, LockKeyhole, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/auction/money";
import { FinanceTransferSlip } from "@/components/dashboard/finance-transfer-slip";
import {
  reserveExternalPayoutAction,
  confirmExternalPayoutAction,
  cancelExternalPayoutAction,
} from "@/server/actions/external-payouts";

export type ExternalPayoutClaim = {
  payout_id: string;
  amount_minor: number;
  currency: string;
  rail: "ECOCASH" | "SMILECASH";
  status: "RESERVED" | "RECEIPT_CONFIRMED" | "CANCELLED";
  destination_phone_e164: string;
  receipt_reference: string | null;
  reserved_at: string;
};

export function ExternalPayoutPanel({
  payoutId, amountMinor, currency, claim, eligible,
  canReserve, canConfirm, highValueApproved,
}: {
  payoutId: string;
  amountMinor: number;
  currency: string;
  claim: ExternalPayoutClaim | null;
  eligible: boolean;
  canReserve: boolean;
  canConfirm: boolean;
  highValueApproved: boolean;
}) {
  const [rail, setRail] = useState<"ECOCASH" | "SMILECASH">("ECOCASH");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [receiptVerified, setReceiptVerified] = useState(false);
  const [cancellation, setCancellation] = useState(false);
  const [noMoneySent, setNoMoneySent] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(kind: "reserve" | "confirm" | "cancel") {
    if (pending) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = kind === "reserve"
          ? await reserveExternalPayoutAction({ payoutId, rail, reason: reason.trim() })
          : kind === "confirm"
            ? await confirmExternalPayoutAction({
              payoutId, reference: reference.trim(), note: evidence.trim(),
              sellerReceiptVerified: receiptVerified,
            })
            : await cancelExternalPayoutAction({
              payoutId, noTransferSent: noMoneySent, reason: reason.trim(),
            });
        setFeedback({
          ok: result.ok,
          text: result.ok
            ? kind === "reserve"
              ? "Wallet transfer reserved. NO money has been sent by BidBlitz. Send externally only once, then verify the seller's actual receipt."
              : kind === "confirm"
                ? "Seller receipt and exact reference recorded. Payout is closed and cannot be sent again."
                : "Claim cancelled after confirmation that NO money was sent."
            : result.message,
        });
        if (result.ok) {
          setReason(""); setEvidence(""); setReference("");
          setReceiptVerified(false); setCancellation(false);
          router.refresh();
        }
      } catch {
        setFeedback({ ok: false, text: "Outcome uncertain. Refresh the database before any retry or external payment." });
      }
    });
  }

  if (claim?.status === "CANCELLED") {
    return <p className="rounded-xl border border-muted p-4 text-xs leading-6 text-muted-foreground">
      This external reservation was cancelled with an audit trail. The previous attempt cannot be reopened;
      check whether a Linkwa payout is now appropriate before creating any further payment.
    </p>;
  }
  if (claim?.status === "RECEIPT_CONFIRMED") {
    return <p className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-xs leading-6 text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      External seller receipt recorded. Reference: <strong className="break-all">{claim.receipt_reference}</strong>.
      No repeat payment is permitted.
    </p>;
  }

  if (!claim && (!eligible || !canReserve)) return null;

  return (
    <section className="space-y-4 rounded-xl border border-orange-500/30 bg-orange-500/[.035] p-4"
      aria-label="External seller wallet settlement" data-testid="external-payout-panel">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-500/10 text-orange-700 dark:text-orange-300">
          <Wallet className="size-5" aria-hidden />
        </span>
        <div>
          <h4 className="text-sm font-extrabold">SmileCash / EcoCash settlement</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Use when buyer collections settle into your SmileCash wallet but the Linkwa Developer payout balance is insufficient.
            BidBlitz reserves and records the amount; you actually transfer funds externally.
          </p>
        </div>
      </div>
      {claim?.status === "RESERVED" ? (
        <>
          <div className="grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold text-muted-foreground">Exact seller proceeds</p>
              <p className="mt-1 text-lg font-black"><Money minor={claim.amount_minor} currency={claim.currency} /></p>
            </div>
            <div>
              <p className="text-xs font-bold text-muted-foreground">External transfer destination</p>
              <p className="mt-1 break-all font-mono font-bold">{claim.destination_phone_e164}</p>
              <p className="text-xs font-semibold">{claim.rail} · saved at reservation</p>
            </div>
          </div>
          <FinanceTransferSlip amountMinor={claim.amount_minor} currency={claim.currency}
            recipient="Seller of this BidBlitz transaction"
            destination={claim.destination_phone_e164} rail={claim.rail} reference={claim.payout_id}
            reason="Seller proceeds after independently confirmed auction handover" />
          <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs leading-6">
            <AlertTriangle className="mt-1 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            This sale is RESERVED for a manual wallet transfer. Automatic Linkwa payout instructions are blocked by the database.
            Never mark paid until the seller confirms receipt in their destination wallet.
          </p>
          {canConfirm ? (
            <div className="space-y-3">
              {!highValueApproved && <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                An independent second reviewer must approve this high-value payout before you can record receipt.
              </p>}
              <label className="block space-y-1.5 text-xs font-bold">
                <span>Exact external transfer reference</span>
                <input value={reference} onChange={e => setReference(e.target.value)}
                  maxLength={200} autoComplete="off" placeholder="Transaction reference on the wallet receipt"
                  className="h-11 w-full rounded-lg border bg-background px-3 text-sm"/>
              </label>
              <label className="block space-y-1.5 text-xs font-bold">
                <span>Evidence of seller receipt and settlement</span>
                <textarea value={evidence} onChange={e => setEvidence(e.target.value)}
                  maxLength={1500} rows={3} placeholder="Describe how receipt was checked, payer wallet statement and confirmation time."
                  className="w-full rounded-lg border bg-background p-3 text-sm"/>
              </label>
              <label className="flex items-start gap-2 text-xs leading-6">
                <input type="checkbox" checked={receiptVerified} onChange={e => setReceiptVerified(e.target.checked)}
                  className="mt-1 size-4 shrink-0 accent-primary" />
                <span>I have independently verified that the seller actually received this exact amount in the destination wallet.</span>
              </label>
              <Button type="button" disabled={pending || !highValueApproved || !receiptVerified || reference.trim().length < 6 || evidence.trim().length < 25}
                onClick={() => run("confirm")} className="min-h-11">
                <ClipboardCheck className="mr-2 size-4" aria-hidden />
                {pending ? "Recording…" : "Record independently verified seller payment"}
              </Button>
            </div>
          ) : <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="size-4" aria-hidden /> A finance operator with payout-recording permission must verify this receipt.
          </p>}
          {canReserve && (
            <details className="border-t pt-3">
              <summary className="cursor-pointer text-xs font-bold">Cancel reservation (only if absolutely no money was transferred)</summary>
              <div className="mt-3 space-y-3">
                <label className="block space-y-1.5 text-xs font-bold">
                  <span>Reason for cancellation</span>
                  <textarea value={reason} onChange={e => setReason(e.target.value)}
                    maxLength={1000} rows={2} className="w-full rounded-lg border bg-background p-3 text-sm" />
                </label>
                <label className="flex items-start gap-2 text-xs leading-5">
                  <input type="checkbox" checked={noMoneySent} onChange={e => setNoMoneySent(e.target.checked)} className="mt-0.5 accent-primary" />
                  <span>I verified no transfer attempt was sent to the bank, SmileCash, or EcoCash.</span>
                </label>
                <Button type="button" variant="outline" disabled={pending || !noMoneySent || reason.trim().length < 25}
                  onClick={() => run("cancel")}>Cancel unused reservation</Button>
              </div>
            </details>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-bold">Reserve the frozen seller amount: <Money minor={amountMinor} currency={currency} /></p>
          <label className="block space-y-1.5 text-xs font-bold">
            <span>Transfer destination rail</span>
            <select value={rail} onChange={e=>setRail(e.target.value as "SMILECASH" | "ECOCASH")}
              className="h-11 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="ECOCASH">EcoCash</option>
              <option value="SMILECASH">SmileCash</option>
            </select>
          </label>
          <label className="block space-y-1.5 text-xs font-bold">
            <span>Reason for manual transfer</span>
            <textarea value={reason} onChange={e=>setReason(e.target.value)}
              maxLength={1000} rows={2} placeholder="Explain why external disbursement is required and what settlement funds were verified."
              className="w-full rounded-lg border bg-background p-3 text-sm"/>
          </label>
          <Button type="button" variant="outline" disabled={pending || reason.trim().length < 20}
            onClick={() => run("reserve")} className="min-h-11">
            {pending ? "Reserving…" : "Reserve external payout (no transfer yet)"}
          </Button>
          <p className="text-[11px] leading-5 text-muted-foreground">
            No funds are moved by this button. A real transfer must be initiated through your authorized wallet or bank service,
            then the receipt recorded here. Payout reference and seller amount cannot be invented or changed.
          </p>
        </div>
      )}
      {feedback && (
        <p role={feedback.ok ? "status" : "alert"} className={feedback.ok
          ? "rounded-lg bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
          : "rounded-lg bg-destructive/10 p-3 text-xs font-semibold text-destructive"}>
          {feedback.text}
        </p>
      )}
    </section>
  );
}
