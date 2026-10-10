import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, CircleCheck, LockKeyhole, ShieldAlert, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { readFinanceOperations } from "@/server/finance/operations";
import { payoutTriage, safeMinor, type PayoutTriage } from "@/lib/finance/operations";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { Money } from "@/components/auction/money";
import { PayoutControls } from "@/components/dashboard/payout-controls";
import { LinkwaPayoutButton } from "@/components/dashboard/linkwa-payout-button";
import { PayoutApprovalPanel, type PayoutApproval } from "@/components/dashboard/payout-approval-panel";
import { ProviderStatementPanel } from "@/components/dashboard/provider-statement-panel";
import type { SellerPayoutStatus } from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "Payout Desk",
  description: "Restricted seller payout review and provider reconciliation.",
  robots: { index: false, follow: false },
};

const triageLabel: Record<PayoutTriage, string> = {
  paid: "Recorded paid",
  hold: "Frozen / disputed",
  reconcile: "Reconcile urgently",
  ready: "Eligible for review",
  waiting: "Awaiting eligibility",
};
const triageStyle: Record<PayoutTriage, string> = {
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  hold: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  reconcile: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  ready: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  waiting: "border-border bg-muted text-muted-foreground",
};

export default async function FinancePayoutsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/finance/payouts");

  const [canViewPayouts, canManageTeam, canDisputes, canMutate, canReview, profileRes, paymentRes] =
    await Promise.all([
      hasPermission(user.id, "payouts.view"),
      hasPermission(user.id, "admin.manage_team"),
      hasPermission(user.id, "disputes.view"),
      hasPermission(user.id, "payouts.transition"),
      hasPermission(user.id, "payouts.review"),
      supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
      supabase.from("payment_settings").select("payments_enabled").maybeSingle(),
    ]);
  if (!canViewPayouts) redirect("/");
  const canOperate = Boolean(canMutate && profileRes.data?.is_admin === true);
  const paymentsEnabled = !paymentRes.error && paymentRes.data?.payments_enabled === true;
  const data = await readFinanceOperations(90);
  const payouts = data.ok ? data.data.payouts : [];
  // Read under the staff session; failed reads block high-value actions.
  const approvalRes = payouts.length > 0
    ? await supabase.from("payout_approval_requests")
        .select("id, payout_id, requested_by, reviewed_by, status, requested_at, reviewed_at")
        .in("payout_id", payouts.map((p) => p.id))
        .in("status", ["REQUESTED", "APPROVED"])
    : { data: [], error: null };
  const approvals = new Map<string, PayoutApproval>();
  for (const row of (approvalRes.data ?? []) as Array<PayoutApproval & { payout_id: string }>) {
    approvals.set(row.payout_id, row);
  }
  const counts = {
    reconcile: payouts.filter((x) => payoutTriage(x) === "reconcile").length,
    hold: payouts.filter((x) => payoutTriage(x) === "hold").length,
    ready: payouts.filter((x) => payoutTriage(x) === "ready").length,
  };

  return (
    <div className="page-container space-y-7 py-8 sm:py-12" data-testid="admin-finance-payouts">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-500/20 bg-[#161719] p-6 text-white shadow-xl sm:p-9">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-orange-300">
          <Wallet className="size-4" aria-hidden /> Finance / Settlement operations
        </p>
        <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] sm:text-5xl">
          Seller payout desk<span className="text-orange-400">.</span>
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
          Verify handover, recipient readiness, dispute safety, and the provider&apos;s evidence
          before instructing or recording seller transfers. Provider acknowledgement is not final settlement.
        </p>
        <p className="mt-4 text-xs font-bold uppercase tracking-wider text-zinc-400">
          Payment switch: <span className={paymentsEnabled ? "text-emerald-300" : "text-amber-300"}>
            {paymentsEnabled ? "Enabled" : "Paused"}
          </span>
        </p>
      </header>

      <AdminNav active="finance" showTeam={canManageTeam} disputeCount={0} />
      <div className="flex flex-wrap gap-3 text-sm font-bold">
        <Link href="/admin/finance" className="inline-flex items-center gap-1 text-primary hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Finance overview
        </Link>
        <Link href="/admin/finance/payments" className="inline-flex items-center gap-1 text-primary hover:underline">
          Buyer payment ledger <ArrowRight className="size-4" aria-hidden />
        </Link>
        {canDisputes && <Link href="/admin/disputes" className="text-primary hover:underline">Dispute cases</Link>}
      </div>

      {!data.ok ? (
        <p className="rounded-xl border border-destructive/35 bg-destructive/10 p-5 text-sm font-semibold text-destructive" role="alert">{data.message}</p>
      ) : (
        <>
          <section aria-label="Payout status summary" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">Provider reconciliation</p>
              <p className="mt-2 text-4xl font-black tabular-nums">{counts.reconcile}</p>
            </div>
            <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-red-700 dark:text-red-300">Held and disputed</p>
              <p className="mt-2 text-4xl font-black tabular-nums">{counts.hold}</p>
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Eligibility checks passed</p>
              <p className="mt-2 text-4xl font-black tabular-nums">{counts.ready}</p>
              <p className="mt-1 text-xs text-muted-foreground">Not authorization to pay; final provider checks still apply</p>
            </div>
          </section>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6">
            <p className="flex items-start gap-2 font-bold"><AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden />
              A zero Linkwa dashboard balance cannot prove the recipient received funds.
            </p>
            <p className="mt-1 text-muted-foreground">
              SmileCash or another settlement account may be separate. Reconcile provider statement, account settlement
              and seller receipt. Do not resend an ambiguous PAYOUT_DUE instruction.
            </p>
          </div>
          <ProviderStatementPanel payoutReferences={payouts.map((p) => ({ reference: p.payoutReference, title: p.auctionTitle ?? "Auction" }))} />
          <section aria-labelledby="payout-list-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="payout-list-heading" className="text-2xl font-black tracking-tight">Payout worklist</h2>
              <p className="text-xs text-muted-foreground">Latest {payouts.length} rows; provider-sensitive cases first</p>
            </div>
            {payouts.length === 0 ? (
              <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                No payout records. A payout is created only after a verified buyer payment.
              </p>
            ) : (
              <ul className="space-y-3">
                {payouts.map((payout) => {
                  const triage = payoutTriage(payout);
                  const amount = safeMinor(payout.amountMinor);
                  const approval = approvals.get(payout.id) ?? null;
                  const highValue = amount !== null && amount >= 10000 && payout.status !== "PAID_OUT";
                  const highValueCleared = !highValue || (!approvalRes.error && approval?.status === "APPROVED");
                  const eligibleToInstruct = canOperate && paymentsEnabled && triage === "ready"
                    && payout.currency === "USD" && amount !== null && amount > 0 && highValueCleared;
                  return (
                    <li key={payout.id} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" data-testid="finance-payout-row">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{payout.sellerName}</p>
                          <h3 className="mt-1 text-lg font-black tracking-tight">{payout.auctionTitle ?? "Listing removed"}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">Transaction {payout.transactionId.slice(0, 8)} · {payout.status.replaceAll("_", " ")}</p>
                        </div>
                        <span className={`rounded-lg border px-3 py-2 text-xs font-extrabold ${triageStyle[triage]}`}>
                          {triageLabel[triage]}
                        </span>
                      </div>
                      <div className="grid gap-3 rounded-xl bg-muted/35 p-4 text-sm sm:grid-cols-4">
                        <div><p className="text-xs font-semibold text-muted-foreground">Seller proceeds</p><p className="mt-1 text-xl font-black">{amount === null ? "Unavailable" : <Money minor={amount} currency={payout.currency} />}</p></div>
                        <div><p className="text-xs font-semibold text-muted-foreground">Buyer payment</p><p className="mt-1 font-bold">{payout.paymentStatus}</p></div>
                        <div><p className="text-xs font-semibold text-muted-foreground">Buyer handover</p><p className="mt-1 font-bold">{payout.deliveryConfirmedAt ? "Confirmed" : "Not confirmed"}</p></div>
                        <div><p className="text-xs font-semibold text-muted-foreground">Seller wallet</p><p className="mt-1 font-bold">{payout.walletReady ? "Ready" : "Setup required"}</p></div>
                      </div>
                      {payout.hasOpenDispute && (
                        <p role="status" className="flex gap-2 rounded-lg bg-red-500/10 p-3 text-xs font-bold text-red-700 dark:text-red-300">
                          <ShieldAlert className="size-4 shrink-0" aria-hidden />
                          Open dispute. Do not release this payout.
                        </p>
                      )}
                      {triage === "reconcile" && (
                        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                          {payout.payoutReference
                            ? "Provider instruction reference is on file, but final seller receipt is not independently verified. Check the provider statement and seller before marking paid."
                            : "Provider outcome is UNKNOWN and no reference is recorded. A previous instruction may have moved funds. Never retry this payout automatically."}
                        </p>
                      )}
                      {triage === "paid" && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CircleCheck className="size-4" aria-hidden /> Recorded paid in BidBlitz. This status is an internal ledger event, not a bank statement.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        {payout.payoutReference && (
                          <p className="break-all text-xs text-muted-foreground">Provider reference: <strong className="text-foreground">{payout.payoutReference}</strong></p>
                        )}
                        <p className="text-xs text-muted-foreground">Updated: {new Date(payout.updatedAt).toLocaleString("en-US")}</p>
                      </div>
                      {highValue && (
                        approvalRes.error ? (
                          <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-xs text-destructive">
                            Approval status unavailable. High-value payout actions are blocked.
                          </p>
                        ) : (
                          <PayoutApprovalPanel
                            payoutId={payout.id}
                            approval={approval}
                            viewerId={user.id}
                            canRequest={canMutate}
                            canReview={canReview}
                          />
                        )
                      )}
                      {eligibleToInstruct && <LinkwaPayoutButton payoutId={payout.id} amountMinor={amount!} currency={payout.currency} />}
                      {canOperate && amount !== null && (
                        <details className="rounded-xl border bg-muted/15 p-3">
                          <summary className="cursor-pointer text-sm font-bold">Owner-only manual status review</summary>
                          <p className="mb-3 mt-2 text-xs leading-5 text-muted-foreground">
                            The database enforces allowed state transitions. Recording PAID_OUT is an irreversible
                            human attestation of a verified transfer; never use an unconfirmed instruction as proof.
                          </p>
                          <PayoutControls payoutId={payout.id} status={payout.status as SellerPayoutStatus}
                            amountMinor={amount} currency={payout.currency}
                            deliveryConfirmedAt={payout.deliveryConfirmedAt} />
                        </details>
                      )}
                      {!canOperate && <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <LockKeyhole className="size-4" aria-hidden /> Read-only financial access. A platform owner handles payout instructions.
                      </p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <footer className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-6 text-muted-foreground">
        <BadgeCheck className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
        <span>BidBlitz owes each seller the net recorded on their transaction, not its gross receipt.
          The platform&apos;s 5% is a recorded fee; provider charges and real settlement must be verified separately.</span>
      </footer>
    </div>
  );
}
