import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Gavel } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getBuying } from "@/server/queries";
import { AuctionCard } from "@/components/auction/auction-card";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Money } from "@/components/auction/money";
import { Button } from "@/components/ui/button";
import { isClosed } from "@/lib/auction-status";
import type { AuctionCardData } from "@/server/queries";

export const metadata: Metadata = {
  title: "Bidding",
  description: "Auctions you are bidding on and wins to follow up on.",
  robots: { index: false, follow: false },
};

type BuyingRow = AuctionCardData & {
  myBidMinor: number;
  isWinning: boolean;
  won: boolean;
  winnerId: string | null;
};

/**
 * Exactly one badge per row, in priority order: a settled win beats "you're
 * winning", which beats "you've been outbid". A closed auction shows nothing —
 * the outcome is on the detail page, not smeared over the card.
 */
function badgeFor(item: BuyingRow): React.ReactNode {
  if (item.won) {
    return (
      <span className="rounded-full bg-won px-2 py-0.5 text-[11px] font-semibold text-won-foreground shadow-sm" data-testid="won-badge">
        You won
      </span>
    );
  }
  if (isClosed(item.status)) return null;
  if (item.isWinning) {
    return (
      <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-sm" data-testid="winning-badge">
        You’re winning
      </span>
    );
  }
  if (item.bidCount > 0) {
    return (
      <span className="rounded-full bg-ending px-2 py-0.5 text-[11px] font-semibold text-ending-foreground shadow-sm" data-testid="outbid-badge">
        Outbid
      </span>
    );
  }
  return null;
}

export default async function BuyingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/buying");

  const items = await getBuying(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buying"
        description="Every auction you’ve put a bid on, newest first."
      />

      <div data-testid="buying-list">
        {items.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="You haven’t bid on anything yet"
            description="Auctions you bid on appear here with your current standing."
            action={
              <Button asChild>
                <Link href="/browse">Browse auctions</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li key={item.id}>
                <AuctionCard
                  auction={item}
                  badge={badgeFor(item)}
                  meta={
                    <div
                      data-testid="my-bid"
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-muted-foreground">Your bid</span>
                      {/* `getBuying` doesn't project currency; the sell schema
                          pins every auction to USD, which is `<Money>`'s default. */}
                      <span className="font-medium" data-numeric>
                        <Money minor={item.myBidMinor} />
                      </span>
                    </div>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
