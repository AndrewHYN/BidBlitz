import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CircleCheck,
  Clock3,
  Landmark,
  Scale,
  WalletCards,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { PageHeader } from "@/components/auction/page-header";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { Money } from "@/components/auction/money";
import { Button } from "@/components/ui/button";
import { readLinkwaEnvironment } from "@/server/payments/config";
import { fetchLinkwaBalance } from "@/server/payments/linkwa-payouts";
import { describeLinkwaBalance, type BalanceDisplay } from "@/server/payments/balance-display";
import { PaymentProviderRequestError } from "@/server/payments/provider";

export const metadata: Metadata = {
  title: "Finance",
  description: "BidBlitz payment, fee and seller payout operations.",
  robots: { index: false, follow: false },
};

type Bucket = { count: number; amountMinor: number };

type FinanceSnapshot = {
  asOf: string;
  currency: string;
  feeBps: number;
  paymentsEnabled: boolean;
  allTime: {
    salesCount: number;
    grossMinor: number;
    feeMinor: number;
    sellerMinor: number;
  };
  today: {
    salesCount: number;
    grossMinor: number;
    feeMinor: number;
    sellerMinor: number;
  };
  payouts: Record<string, Bucket>;
  wallets: {
    ready: number;
    needsWallet: number;
    linking: number;
    error: number;
    unlinked: number;
  };
  openDisputes: number;
  awaitingPayment: number;
  attentionPayouts: number;
};

function asSnapshot(value: unknown): FinanceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  return value as FinanceSnapshot;
}

function sumBucket(snapshot: FinanceSnapshot, status: string): Bucket {
  return snapshot.payouts[status] ?? { count: 0, amountMinor: 0 };
}

export default async function FinancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/finance");

  const [canPayments, canPayouts, canManageTeam] = await Promise.all([
    hasPermission(user.id, "payments.view"),
    hasPermission(user.id, "payouts.view"),
    hasPermission(user.id, "admin.manage_team"),
  ]);
  if (!canPayments && !canPayouts) redirect("/");

  const { data, error } = await supabase.rpc("admin_finance_snapshot");
  const snapshot = error ? null : asSnapshot(data);

  let linkwa:
    | BalanceDisplay
    | { state: "unavailable"; message: string } = {
    state: "unavailable",
    message: "Linkwa balance could not be read.",
  };

  const env = readLinkwaEnvironment();
  if (env.state === "ready" && env.config) {
    try {
      const balances = await fetchLinkwaBalance({
        apiKey: env.config.apiKey,
        baseUrl: env.config.baseUrl,
      });
      linkwa = describeLinkwaBalance(balances);
    } catch (error) {
      const status = error instanceof PaymentProviderRequestError ? error.httpStatus : undefined;
      const detail = status === 401
        ? "Linkwa rejected API authentication (HTTP 401). Check the deployed production app key."
        : status === 403
          ? "Linkwa denied API access (HTTP 403). Check production app activation and API permissions with Linkwa."
          : status
            ? `Linkwa balance request failed (HTTP ${status}). Check the provider’s availability and endpoint access.`
            : error instanceof PaymentProviderRequestError && error.message === "Could not reach Linkwa balance/statement endpoint."
              ? "Linkwa could not be reached within the request window. Check connectivity or provider availability."
              : "Linkwa returned an unexpected or unreadable balance response. Provider response compatibility needs investigation.";
      linkwa = {
        state: "unavailable",
        message: `${detail} No money was moved.`,
      };
    }
  } else {
    linkwa = {
      state: "unavailable",
      message: "Linkwa production payout configuration is not ready on this deployment.",
    };
  }

  const activeDisputes = snapshot?.openDisputes ?? 0;

  return (
    <div className="page-container space-y-7 py-10 sm:py-14">
      <PageHeader
        title="Finance"
        description="The money view for operating BidBlitz: what buyers paid, what BidBlitz earned, what sellers are owed, and what needs attention."
      />
      <AdminNav
        active="finance"
        showTeam={canManageTeam}
        showMarketing
        disputeCount={activeDisputes}
      />

      <section aria-label="Finance workspaces" className="grid gap-4 md:grid-cols-2">
        {canPayments && (
          <Link href="/admin/finance/payments"
            className="group relative overflow-hidden rounded-2xl border border-orange-400/20 bg-[#161719] p-6 text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-12 place-items-center rounded-xl bg-white/10 text-orange-300">
                <Banknote className="size-6" aria-hidden />
              </span>
              <ArrowRight className="size-5 text-orange-300 transition group-hover:translate-x-1" aria-hidden />
            </div>
            <h2 className="mt-5 text-xl font-black tracking-tight">Buyer payment ledger</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Every collection, frozen 5% fee, seller liability, payment status and provider reference.
            </p>
            <span className="mt-4 block text-xs font-bold uppercase tracking-wider text-orange-300">Open payments desk</span>
          </Link>
        )}
        {canPayouts && (
          <Link href="/admin/finance/payouts"
            className="group relative overflow-hidden rounded-2xl border border-orange-400/20 bg-[#161719] p-6 text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-12 place-items-center rounded-xl bg-white/10 text-orange-300">
                <WalletCards className="size-6" aria-hidden />
              </span>
              <ArrowRight className="size-5 text-orange-300 transition group-hover:translate-x-1" aria-hidden />
            </div>
            <h2 className="mt-5 text-xl font-black tracking-tight">Seller payout desk</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Review payouts, seller wallet readiness, disputes and the read-only Linkwa statement.
            </p>
            <span className="mt-4 block text-xs font-bold uppercase tracking-wider text-orange-300">Open payout operations</span>
          </Link>
        )}
      </section>

      {!snapshot ? (
        <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div>
              <h2 className="font-bold">Finance snapshot unavailable</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                BidBlitz could not read the authorised finance snapshot. Payments should remain paused until this page is healthy.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section
            className={
              snapshot.paymentsEnabled
                ? "finance-hero finance-hero-live relative overflow-hidden rounded-2xl border p-6 shadow-xl"
                : "finance-hero relative overflow-hidden rounded-2xl border p-6 shadow-xl"
            }
          >
            <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
                  <Landmark className="size-4" aria-hidden />
                  Money controls
                </div>
                <h2 className="mt-2 text-2xl font-bold tracking-[-0.025em]">
                  {snapshot.paymentsEnabled ? "Payments are live" : "Payments are paused"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {snapshot.paymentsEnabled
                    ? "New checkout and seller payout release are enabled. Signed provider webhooks remain the source of truth for buyer payment state."
                    : "New checkout and seller payout instructions are disabled. Signed provider webhooks still reconcile payments that were already in flight."}
                </p>
              </div>
              <span
                className={
                  snapshot.paymentsEnabled
                    ? "grid size-14 shrink-0 place-items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 shadow-sm"
                    : "grid size-14 shrink-0 place-items-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600 shadow-sm"
                }
              >
                {snapshot.paymentsEnabled ? (
                  <CircleCheck className="size-6" aria-hidden />
                ) : (
                  <Clock3 className="size-6" aria-hidden />
                )}
              </span>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="money-stat-card rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Buyer payments</p>
              <p className="mt-2 text-2xl font-bold" data-numeric>
                <Money minor={snapshot.allTime.grossMinor} currency={snapshot.currency} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{snapshot.allTime.salesCount} confirmed sales</p>
            </div>
            <div className="money-stat-card rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">BidBlitz earned</p>
              <p className="mt-2 text-2xl font-bold text-primary" data-numeric>
                <Money minor={snapshot.allTime.feeMinor} currency={snapshot.currency} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{snapshot.feeBps / 100}% marketplace fee</p>
            </div>
            <div className="money-stat-card rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Seller proceeds</p>
              <p className="mt-2 text-2xl font-bold" data-numeric>
                <Money minor={snapshot.allTime.sellerMinor} currency={snapshot.currency} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Frozen from transactions, not recalculated later</p>
            </div>
            <div className="money-stat-card rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">Today</p>
              <p className="mt-2 text-2xl font-bold" data-numeric>
                <Money minor={snapshot.today.feeMinor} currency={snapshot.currency} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                BidBlitz fee from {snapshot.today.salesCount} confirmed sale{snapshot.today.salesCount === 1 ? "" : "s"}
              </p>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <WalletCards className="size-5 text-primary" aria-hidden />
                <h2 className="text-lg font-bold">Seller payout pipeline</h2>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ["Waiting for handover", "WAITING_FOR_FULFILMENT"],
                  ["Handover confirmed", "DELIVERY_CONFIRMED"],
                  ["Ready / pending", "PAYOUT_PENDING"],
                  ["Provider-sensitive", "PAYOUT_DUE"],
                  ["Paid out", "PAID_OUT"],
                  ["Held", "HELD"],
                  ["Disputed", "DISPUTED"],
                ].map(([label, status]) => {
                  const bucket = sumBucket(snapshot, status);
                  return (
                    <div key={status} className="rounded-xl border bg-muted/15 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{bucket.count} payout{bucket.count === 1 ? "" : "s"}</p>
                        </div>
                        <p className="text-sm font-bold" data-numeric>
                          <Money minor={bucket.amountMinor} currency={snapshot.currency} />
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <section className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Banknote className="size-5 text-primary" aria-hidden />
                  <h2 className="font-bold">Linkwa balance</h2>
                </div>
                {linkwa.state === "ready" ? (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-muted/15 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Available</p>
                      <p className="mt-1 text-xl font-bold" data-numeric>
                        <Money minor={Number(linkwa.availableMinor)} currency="USD" />
                      </p>
                    </div>
                    <div className="rounded-xl border bg-muted/15 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending</p>
                      <p className="mt-1 text-xl font-bold" data-numeric>
                        <Money minor={Number(linkwa.pendingMinor)} currency="USD" />
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{linkwa.message}</p>
                )}
              </section>

              <section className="rounded-2xl border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-primary" aria-hidden />
                  <h2 className="font-bold">Needs attention</h2>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <Link
                    href="/admin/disputes"
                    className="flex items-center justify-between rounded-lg border px-3 py-2 transition hover:bg-accent/40"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Scale className="size-4 text-muted-foreground" aria-hidden />
                      Open disputes
                    </span>
                    <strong data-numeric>{snapshot.openDisputes}</strong>
                  </Link>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <span>Ambiguous / held payouts</span>
                    <strong data-numeric>{snapshot.attentionPayouts}</strong>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <span>Awaiting buyer payment</span>
                    <strong data-numeric>{snapshot.awaitingPayment}</strong>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <span>Seller wallets ready</span>
                    <strong data-numeric>{snapshot.wallets.ready}</strong>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <span>Seller wallets needing setup</span>
                    <strong data-numeric>
                      {snapshot.wallets.needsWallet + snapshot.wallets.error + snapshot.wallets.unlinked}
                    </strong>
                  </div>
                </div>
              </section>
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="font-bold">Money reconciliation</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              For confirmed sales, the ledger equation should remain: buyer sale amount = BidBlitz fee + seller proceeds.
            </p>
            <div className="mt-4 flex flex-col gap-3 rounded-xl border bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span data-numeric><Money minor={snapshot.allTime.grossMinor} currency={snapshot.currency} /></span>
                <span className="text-muted-foreground">=</span>
                <span data-numeric><Money minor={snapshot.allTime.feeMinor} currency={snapshot.currency} /></span>
                <span className="text-muted-foreground">+</span>
                <span data-numeric><Money minor={snapshot.allTime.sellerMinor} currency={snapshot.currency} /></span>
              </div>
              {snapshot.allTime.grossMinor === snapshot.allTime.feeMinor + snapshot.allTime.sellerMinor ? (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
                  <CircleCheck className="size-4" aria-hidden />
                  Balanced
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-destructive">
                  <AlertTriangle className="size-4" aria-hidden />
                  Investigate
                </span>
              )}
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/admin/disputes">Review disputes</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin">Back to operations</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
