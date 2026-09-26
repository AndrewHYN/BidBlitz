import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, ArrowRight, Clock, Gavel, Tag, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getBuying, getSelling, getTransactions, getWatchlist } from "@/server/queries";
import { CARD_ENDING_SOON_MS } from "@/lib/auction-status";
import { EmptyState, PageHeader, SectionHeading } from "@/components/auction/page-header";
import { Countdown } from "@/components/auction/countdown";
import { Money } from "@/components/auction/money";
import { TransactionBadge } from "@/components/auction/status-badge";
import { Button } from "@/components/ui/button";
import { SettleButton } from "@/components/dashboard/settle-button";
import { isPaymentProviderConfigured } from "@/server/payments/config";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your bidding, selling and settlement activity on BidBlitz.",
  robots: { index: false, follow: false },
};

function Stat({
  label,
  value,
  href,
  icon: Icon,
}: {
  label: string;
  value: number;
  href: string;
  icon: typeof Gavel;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className="mt-2 block text-3xl font-semibold tabular-nums" data-numeric>
        {value}
      </span>
      <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-primary">
        Open
        <ArrowRight className="size-3" aria-hidden />
      </span>
    </Link>
  );
}

export default async function DashboardOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const [buying, selling, watchlist, transactions] = await Promise.all([
    getBuying(user.id),
    getSelling(user.id),
    getWatchlist(user.id),
    getTransactions(user.id),
  ]);

  // eslint-disable-next-line react-hooks/purity -- server component: one render per request
  const now = Date.now();

  const endingSoon = selling.filter((item) => {
    if (item.status !== "LIVE" || !item.endsAt) return false;
    const remaining = Date.parse(item.endsAt) - now;
    return remaining > 0 && remaining <= CARD_ENDING_SOON_MS;
  });

  const dueSettle = selling.filter((item) => {
    if (item.status === "ENDED") return true;
    return item.status === "LIVE" && item.endsAt !== null && Date.parse(item.endsAt) <= now;
  });

  const activeListings = selling.filter(
    (item) => item.status === "LIVE" || item.status === "SCHEDULED"
  ).length;

  const latestTransactions = transactions.slice(0, 3);
  const nothingYet =
    buying.length === 0 && selling.length === 0 && watchlist.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Everything you’re bidding on, selling and watching."
      />

      <div data-testid="dashboard-stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Bids placed" value={buying.length} href="/dashboard/buying" icon={Gavel} />
        <Stat
          label="Ending soon"
          value={endingSoon.length}
          href="/dashboard/selling"
          icon={Clock}
        />
        <Stat
          label="Active listings"
          value={activeListings}
          href="/dashboard/selling"
          icon={Tag}
        />
        <Stat
          label="Watchlist"
          value={watchlist.length}
          href="/dashboard/watchlist"
          icon={Activity}
        />
      </div>

      {nothingYet && (
        <EmptyState
          icon={Wallet}
          title="Nothing here yet"
          description="List something to sell, or browse live auctions to place your first bid."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/sell">Start selling</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/browse">Browse auctions</Link>
              </Button>
            </div>
          }
        />
      )}

      <section aria-labelledby="dashboard-settle-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="dashboard-settle-heading" className="inline-flex items-center gap-2">
              Needs settlement
              {dueSettle.length > 0 && (
                <span
                  className="rounded-full bg-ending px-2 py-0.5 text-xs font-medium text-ending-foreground"
                  data-numeric
                >
                  {dueSettle.length}
                </span>
              )}
            </span>
          }
        />

        {dueSettle.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No auctions are waiting on a result right now.
          </p>
        ) : (
          <ul className="space-y-3">
            {dueSettle.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/auction/${item.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    The clock has run out — settle to record the winner, the fee and the proceeds.
                  </p>
                </div>
                <SettleButton auctionId={item.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dashboard-transactions-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="dashboard-transactions-heading">Latest transactions</span>
          }
          action={
            <Link
              href="/dashboard/transactions"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              View all
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        />

        {latestTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Settled sales show up here with the gross, the fee and the proceeds.
          </p>
        ) : (
          <ul className="space-y-3">
            {latestTransactions.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/auction/${row.auction_id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {row.auctions?.title ?? "Auction"}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <TransactionBadge status={row.status} />
                    </span>
                    <span>
                      Gross <Money minor={row.gross_minor} currency={row.currency} />
                    </span>
                    <span>
                      Fee <Money minor={row.fee_minor} currency={row.currency} />
                    </span>
                    <span>
                      Proceeds <Money minor={row.net_minor} currency={row.currency} />
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!isPaymentProviderConfigured() && (
          <p className="text-xs text-muted-foreground">
            No payment provider is configured yet, so no money has moved.
          </p>
        )}
      </section>

      {activeListings > 0 && (
        <section aria-labelledby="dashboard-ending-heading" className="space-y-4">
          <SectionHeading title={<span id="dashboard-ending-heading">Ending soon</span>} />
          <ul className="space-y-3">
            {endingSoon.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                Nothing of yours closes in the next ten minutes.
              </li>
            ) : (
              endingSoon.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
                >
                  <Link
                    href={`/auction/${item.id}`}
                    className="font-medium hover:text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                  <Countdown endsAt={item.endsAt} status={item.status} />
                </li>
              ))
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
