import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Eye,
  Gavel,
  Search,
  Store,
  Tag,
  Trophy,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getBuying, getSelling, getTransactions, getWatchlist } from "@/server/queries";
import { EmptyState, SectionHeading } from "@/components/auction/page-header";
import { Money } from "@/components/auction/money";
import { TransactionBadge } from "@/components/auction/status-badge";
import { AuctionRail } from "@/components/home/auction-rail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettleButton } from "@/components/dashboard/settle-button";

export const metadata: Metadata = {
  title: "My BidBlitz",
  description: "Your bids, watchlist, listings and purchases on BidBlitz.",
  robots: { index: false, follow: false },
};

function QuickAction({
  href,
  label,
  value,
  helper,
  icon: Icon,
  urgent = false,
}: {
  href: string;
  label: string;
  value: number;
  helper: string;
  icon: typeof Gavel;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "group rounded-xl border bg-card p-4 shadow-[0_12px_32px_-26px_rgba(15,23,42,0.5)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md",
        urgent ? "border-ending/50 bg-ending/5" : "border-border/80",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <span
          className={[
            "grid size-9 place-items-center rounded-lg",
            urgent ? "bg-ending/15 text-ending" : "bg-primary/10 text-primary",
          ].join(" ")}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{helper}</p>
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
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

  const liveBids = buying.filter((item) => item.status === "LIVE");
  const winning = liveBids.filter((item) => item.isWinning);
  const outbid = liveBids.filter((item) => !item.isWinning);
  const activeListings = selling.filter(
    (item) => item.status === "LIVE" || item.status === "SCHEDULED"
  );
  // One request-scoped server timestamp; this page is not a reactive client render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const dueSettle = selling.filter(
    (item) =>
      item.status === "ENDED" ||
      (item.status === "LIVE" && item.endsAt !== null && Date.parse(item.endsAt) <= now)
  );
  const latestTransactions = transactions.slice(0, 3);
  const nothingYet =
    buying.length === 0 && selling.length === 0 && watchlist.length === 0;

  return (
    <div className="space-y-9">
      <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_18px_46px_-34px_rgba(15,23,42,0.55)]">
        <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
          <div className="p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              My BidBlitz
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              What are you looking for today?
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Search the marketplace, keep an eye on your bids, or list something in a few steps.
            </p>

            <form action="/browse" method="get" className="mt-5 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Label htmlFor="dashboard-search" className="sr-only">
                  Search BidBlitz
                </Label>
                <Input
                  id="dashboard-search"
                  name="q"
                  type="search"
                  placeholder="Search phones, gaming, fashion, home…"
                  className="h-12 pl-9"
                />
              </div>
              <Button type="submit" size="lg">
                Search
              </Button>
            </form>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link href="/sell">
                  <Tag className="size-3.5" aria-hidden />
                  Sell an item
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/browse">Browse auctions</Link>
              </Button>
            </div>
          </div>

          <div className="border-t bg-muted/25 p-4 sm:p-5 lg:border-l lg:border-t-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              At a glance
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xl font-semibold tabular-nums">{winning.length}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Winning</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xl font-semibold tabular-nums">{outbid.length}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Outbid</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xl font-semibold tabular-nums">{watchlist.length}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Watching</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xl font-semibold tabular-nums">{activeListings.length}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Selling</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {outbid.length > 0 && (
        <section
          data-testid="dashboard-outbid"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ending/45 bg-ending/10 p-4 shadow-sm"
        >
          <div>
            <p className="text-sm font-semibold">
              {outbid.length === 1
                ? "You've been outbid"
                : `You've been outbid on ${outbid.length} auctions`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The auctions are still live. You can bid again before their clocks run out.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/dashboard/buying">See my bids</Link>
          </Button>
        </section>
      )}

      {!nothingYet && (
        <section aria-label="Your BidBlitz shortcuts" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction
            href="/dashboard/buying"
            label="Live bids"
            value={liveBids.length}
            helper="Auctions you've joined that are still open."
            icon={Gavel}
          />
          <QuickAction
            href="/dashboard/buying"
            label="Outbid"
            value={outbid.length}
            helper="Auctions where another bidder currently leads."
            icon={Trophy}
            urgent={outbid.length > 0}
          />
          <QuickAction
            href="/dashboard/watchlist"
            label="Watchlist"
            value={watchlist.length}
            helper="Saved auctions you want to come back to."
            icon={Eye}
          />
          <QuickAction
            href="/dashboard/selling"
            label="My listings"
            value={selling.length}
            helper="Draft, live and completed auctions you've listed."
            icon={Store}
          />
        </section>
      )}

      {nothingYet && (
        <EmptyState
          icon={Wallet}
          title="Your BidBlitz starts here"
          description="Browse live auctions to find a deal, or list something you want buyers to compete for."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/browse">Find an auction</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/sell">Sell something</Link>
              </Button>
            </div>
          }
        />
      )}

      {liveBids.length > 0 && (
        <AuctionRail
          title="Continue bidding"
          description={outbid.length > 0 ? "Somebody is ahead on at least one of these." : "You're currently leading on your live bids."}
          auctions={liveBids.slice(0, 12)}
          testid="home-live"
          emptyTitle="No live bids"
          emptyDescription="Auctions you bid on appear here."
        />
      )}

      {watchlist.length > 0 && (
        <AuctionRail
          title="Your watchlist"
          description="Saved auctions, one tap away."
          auctions={watchlist.slice(0, 12)}
          testid="home-recent"
          emptyTitle="Nothing watched yet"
          emptyDescription="Tap Watch on an auction to save it."
        />
      )}

      {dueSettle.length > 0 && (
        <section aria-labelledby="dashboard-needs-attention" className="space-y-4">
          <SectionHeading
            title={<span id="dashboard-needs-attention">Needs your attention</span>}
          />
          <ul className="space-y-3">
            {dueSettle.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ending/40 bg-ending/5 p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/auction/${item.id}`}
                    className="font-semibold hover:text-primary hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The clock has ended. Record the final auction result.
                  </p>
                </div>
                <SettleButton auctionId={item.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="dashboard-transactions-heading" className="space-y-4">
        <SectionHeading
          title={<span id="dashboard-transactions-heading">Recent purchases & sales</span>}
          action={
            <Link
              href="/dashboard/transactions"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View all
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          }
        />

        {latestTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            When an auction ends with a winner, the purchase or sale appears here.
          </p>
        ) : (
          <ul className="grid gap-3">
            {latestTransactions.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.45)]"
              >
                <div className="min-w-0">
                  <Link
                    href={`/auction/${row.auction_id}`}
                    className="font-semibold hover:text-primary hover:underline"
                  >
                    {row.auctions?.title ?? "Auction"}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <TransactionBadge status={row.status} />
                    <span>
                      Total <Money minor={row.gross_minor} currency={row.currency} />
                    </span>
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dashboard/transactions/${row.id}`}>Open</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
