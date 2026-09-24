import Link from "next/link";
import { redirect } from "next/navigation";
import { Tag } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSelling, getTransactions } from "@/server/queries";
import { AuctionCard } from "@/components/auction/auction-card";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";
import { SettleButton } from "@/components/dashboard/settle-button";
import { SaleSummary } from "@/components/dashboard/sale-summary";
import { isClosed } from "@/lib/auction-status";

export default async function SellingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/selling");

  const [items, transactions] = await Promise.all([
    getSelling(user.id),
    getTransactions(user.id),
  ]);

  // `fee_bps` lives on the transaction row (getSelling projects only amounts),
  // so join it here rather than recomputing a fee the engine already recorded.
  const feeBpsById = new Map(transactions.map((row) => [row.id, row.fee_bps]));

  // eslint-disable-next-line react-hooks/purity -- server component: one render per request
  const now = Date.now();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Selling"
        description="Your listings, from draft through settlement."
        actions={
          <Button asChild>
            <Link href="/sell">New listing</Link>
          </Button>
        }
      />

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
                        />
                      )}

                      {!tx && item.status === "UNSOLD" && (
                        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                          This auction ended with no bids, so nothing was sold.
                        </p>
                      )}

                      {!tx && item.status === "CANCELLED" && (
                        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                          This auction was cancelled before anyone bid.
                        </p>
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
