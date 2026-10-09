import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Tag } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMySellerPayouts, getSelling, getTransactions } from "@/server/queries";
import { getMaxBidOffers } from "@/server/max-bid-queries";
import { Money } from "@/components/auction/money";
import { AuctionCard } from "@/components/auction/auction-card";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";
import { SettleButton } from "@/components/dashboard/settle-button";
import { RelistButton } from "@/components/dashboard/relist-button";
import { SaleSummary } from "@/components/dashboard/sale-summary";
import { isClosed } from "@/lib/auction-status";
import { cancellationReasonLabel } from "@/lib/validation";

export const metadata: Metadata = {
  title: "Selling",
  description: "Your listed auctions, sales and proceeds.",
  robots: { index: false, follow: false },
};

export default async function SellingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/selling");

  const [items, transactions, payouts, maxBidOffers] = await Promise.all([
    getSelling(user.id),
    getTransactions(user.id),
    getMySellerPayouts(),
    getMaxBidOffers(),
  ]);
  // This seller's own pending business, keyed by auction. Both tables are
  // readable by the requester/seller, so missing rows simply mean nothing
  // pending. Two small indexed reads, after the items they key off.
  const itemIds = items.map((item) => item.id);
  const [pendingRequests, pendingReviews] = await Promise.all([
    supabase
      .from("auction_cancellation_requests")
      .select("auction_id")
      .eq("requester_id", user.id)
      .eq("status", "PENDING"),
    itemIds.length > 0
      ? supabase
          .from("listing_reviews")
          .select("auction_id")
          .eq("status", "PENDING")
          .in("auction_id", itemIds)
      : Promise.resolve({ data: [] as Array<{ auction_id: string }> }),
  ]);
  const pendingRequestByAuction = new Set(
    (pendingRequests.data ?? []).map((r) => r.auction_id as string)
  );
  const pendingReviewByAuction = new Set(
    (pendingReviews.data ?? []).map((r) => r.auction_id as string)
  );
  // Why each cancelled listing ended, in the seller's own words or the
  // operator's. One row per auction is the norm (a second cancel is refused),
  // so the latest row is the record.
  const { data: closures } = itemIds.length > 0
    ? await supabase
        .from("auction_cancellations")
        .select("auction_id, reason_code, explanation, actor_role, created_at")
        .in("auction_id", itemIds)
        .order("created_at", { ascending: false })
    : { data: [] as Array<{ auction_id: string }> };
  const closureByAuction = new Map(
    ((closures ?? []) as Array<{
      auction_id: string;
      reason_code: string;
      explanation: string | null;
      actor_role: string;
      created_at: string;
    }>).map((c) => [c.auction_id, c])
  );

  // `fee_bps` lives on the transaction row (getSelling projects only amounts),
  // so join it here rather than recomputing a fee the engine already recorded.
  const feeBpsById = new Map(transactions.map((row) => [row.id, row.fee_bps]));
  // The payout is a SEPARATE record from the sale: "Paid" says the payment
  // provider collected from the buyer, the payout says whether this seller has
  // been paid yet.
  const payoutByTx = new Map(payouts.map((p) => [p.transaction_id, p]));

  // eslint-disable-next-line react-hooks/purity -- server component: one render per request
  const now = Date.now();

  return (
    <div className="space-y-6">
      <PageHeader
        title="My selling"
        description="Manage drafts, live auctions, completed sales and seller payouts in one place."
        actions={
          <Button asChild>
            <Link href="/sell">List another item</Link>
          </Button>
        }
      />

      {maxBidOffers.length > 0 && <section className="rounded-xl border p-5 space-y-3" aria-labelledby="max-offers-heading">
        <h2 id="max-offers-heading" className="font-semibold">Max Bid purchase offers</h2>
        <p className="text-sm text-muted-foreground">Review the current highest offer to sell early. Accepting ends the auction and asks the buyer to pay.</p>
        <ul className="space-y-2">{maxBidOffers.map((offer) => <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{items.find((item) => item.id === offer.auction_id)?.title ?? "Your auction"} · <Money minor={offer.amount_minor} /></span>
          <Link className="font-medium underline" href={`/auction/${offer.auction_id}`}>Review offer</Link>
        </li>)}</ul>
      </section>}

      <div data-testid="selling-list">
        {items.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="You haven’t listed anything yet"
            description="Create a listing, add photos and start a live auction in a couple of minutes."
            action={
              <Button asChild>
                <Link href="/sell">Create a listing</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-6">
            {items.map((item) => {
              const settleDue =
                item.status === "ENDED" ||
                (item.status === "LIVE" && item.endsAt !== null && Date.parse(item.endsAt) <= now);
              const tx = item.transactions[0] ?? null;
              const draftHref = isClosed(item.status) ? undefined : `/sell/${item.id}`;
              const closure = closureByAuction.get(item.id);

              return (
                <li key={item.id} className="space-y-3">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                    <AuctionCard
                      auction={item}
                      href={draftHref ?? `/auction/${item.id}`}
                      meta={
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {item.bidCount === 0 ? "No bids yet" : `${item.bidCount} bid${item.bidCount === 1 ? "" : "s"}`}
                          </span>
                          {draftHref && (
                            <span className="font-medium text-primary">Manage listing</span>
                          )}
                        </div>
                      }
                    />

                    <div className="space-y-3">
                      {item.status === "PENDING_REVIEW" && (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                          <p className="text-sm text-muted-foreground">
                            {pendingReviewByAuction.has(item.id)
                              ? "Under review. The team checks first listings before they go public."
                              : "Waiting for review."}{" "}
                            Manage it from the draft page.
                          </p>
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/sell/${item.id}`}>Manage listing</Link>
                          </Button>
                        </div>
                      )}

                      {item.status === "PAUSED" && (
                        <div className="rounded-xl border bg-card p-4">
                          <p className="text-sm text-muted-foreground">
                            Paused by BidBlitz while the team reviews an issue.
                            Bidding is disabled and the clock is stopped. Only
                            an admin can resume it.
                          </p>
                        </div>
                      )}

                      {pendingRequestByAuction.has(item.id) && item.status === "LIVE" && (
                        <div className="rounded-xl border bg-card p-4">
                          <p className="text-sm text-muted-foreground">
                            You asked the team to end this auction. It stays
                            live until they decide.{" "}
                            <Link
                              href={`/sell/${item.id}`}
                              className="font-medium text-foreground underline underline-offset-2"
                            >
                              Manage the request
                            </Link>
                            .
                          </p>
                        </div>
                      )}

                      {settleDue && item.status !== "SOLD" && item.status !== "UNSOLD" && (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ending/50 bg-ending/10 p-4">
                          <p className="text-sm">
                            The clock has run out. Settle to record the winner, the fee and the
                            proceeds.
                          </p>
                          <SettleButton auctionId={item.id} />
                        </div>
                      )}

                      {tx && (
                        <SaleSummary
                          transaction={{
                            id: tx.id,
                            status: tx.status,
                            gross_minor: tx.gross_minor,
                            fee_minor: tx.fee_minor,
                            net_minor: tx.net_minor,
                            currency: tx.currency,
                          }}
                          feeBps={feeBpsById.get(tx.id) ?? null}
                          payout={payoutByTx.get(tx.id) ?? null}
                        />
                      )}

                      {!tx && item.status === "UNSOLD" && (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                          <p className="text-sm text-muted-foreground">
                            This auction ended with no bids, so nothing was
                            sold. Listing it again copies the details into a
                            new draft; photos need adding before it can be
                            published.
                          </p>
                          <RelistButton auctionId={item.id} />
                        </div>
                      )}

                      {!tx && item.status === "CANCELLED" && (
                        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                          <p>
                            {closure?.actor_role === "admin"
                              ? "BidBlitz ended this listing."
                              : "This auction was cancelled before anyone bid."}
                          </p>
                          {closure && (
                            <p className="mt-1">
                              Reason: {cancellationReasonLabel(closure.reason_code)}
                              {closure.explanation ? ` (${closure.explanation})` : ""}.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
