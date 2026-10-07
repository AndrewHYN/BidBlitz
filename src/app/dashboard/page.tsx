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
import { paymentsRuntimeEnabled } from "@/server/payments/runtime";

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

  const [buying, selling, watchlist, transactions, paymentsEnabled] = await Promise.all([
    getBuying(user.id),
    getSelling(user.id),
    getWatchlist(user.id),
    getTransactions(user.id),
    paymentsRuntimeEnabled(),
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

  /*
   * What actually needs the user, in order.
   *
   * The four counters were equal: bids placed, ending soon, active listings,
   * watchlist. But they are not equally urgent, and treating them as equals is
   * why the page felt like a reporting screen rather than a list of things to
   * do. "You have 3 bids placed" is history. Being outbid is an action with a
   * deadline.
   *
   * So the strip only appears when there is something in it. A dashboard whose
   * first screen is four zeroes tells the user nothing and makes them scroll to
   * find out what to do — the empty state below already answers that case in
   * one sentence.
   *
   * Only being-outbid is lifted to the top. Settling an ended auction already
   * has its own section on this page, with the actual SettleButton beside each
   * auction, and repeating it here as a link would be the same fact twice with
   * the weaker version first.
   *
   * `isWinning` and `won` come from the same query the Buying tab uses, so this
   * cannot disagree with it: an auction is outbid only while it is still live
   * and someone else holds the lead. An auction already won or already closed
   * needs settling or paying, not bidding again.
   */
  const outbid = buying.filter(
    (item) => !item.won && !item.isWinning && item.status === "LIVE"
  );
  const showCounts = !nothingYet;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Your BidBlitz"
        description="See what needs attention first, then jump back into bidding or selling."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/browse">Browse auctions</Link>
            </Button>
            <Button asChild>
              <Link href="/sell">Sell an item</Link>
            </Button>
          </>
        }
      />

      {outbid.length > 0 && (
        <section
          aria-labelledby="dashboard-outbid"
          data-testid="dashboard-outbid"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ending/40 bg-ending/5 p-4 sm:p-5"
        >
          <h2
            id="dashboard-outbid"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight"
          >
            <Gavel className="size-4 text-ending" aria-hidden />
            {outbid.length === 1
              ? "You’ve been outbid. The auction is still live"
              : `You’ve been outbid on ${outbid.length} live auctions`}
          </h2>
          <Button asChild size="sm" variant="outline" data-testid="dashboard-bid-again">
            <Link href="/dashboard/buying">Review my bids</Link>
          </Button>
        </section>
      )}

      {showCounts && (
        <div
          data-testid="dashboard-stats"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Stat label="My bids" value={buying.length} href="/dashboard/buying" icon={Gavel} />
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
      )}

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
              Seller actions
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
            Nothing needs a seller action right now.
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
                    The clock has run out. Settle to record the winner, the fee and the proceeds.
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
            <span id="dashboard-transactions-heading">Recent activity</span>
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

        {!isPaymentProviderConfigured() ? (
          <p className="text-xs text-muted-foreground">
            No payment provider is configured yet, so BidBlitz cannot start checkout.
          </p>
        ) : !paymentsEnabled ? (
          <p className="text-xs font-medium text-primary">
            New checkout and seller payout instructions are temporarily paused by BidBlitz&apos;s payment safety switch.
          </p>
        ) : null}
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
