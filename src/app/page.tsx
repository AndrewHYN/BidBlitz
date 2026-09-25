import Link from "next/link";
import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { getHomeFeed } from "@/server/queries";
import { EmptyState } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";
import { HomeHero } from "@/components/home/home-hero";
import { CategoryChips } from "@/components/home/category-chips";
import { AuctionRail } from "@/components/home/auction-rail";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Discovery home: hero + search, category chips, then the three rails the
 * buyer journey starts from — Ending soon, Live now, Recently listed. The
 * feed is one server round trip; each rail falls back to its own empty state
 * rather than leaving a blank section.
 */
export default async function HomePage() {
  const feed = await getHomeFeed();

  return (
    <div className="page-container space-y-10 py-10 sm:py-14">
      <div className="space-y-6">
        <HomeHero />
        <CategoryChips categories={feed.categories} />
      </div>

      {feed.error ? (
        <EmptyState
          icon={TriangleAlert}
          title="We couldn't load auctions right now"
          description="The marketplace is briefly unavailable. Refresh the page to try again."
          action={
            <Button asChild variant="outline">
              <Link href="/">Refresh</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-10">
          <AuctionRail
            title="Ending soon"
            description="The clock is running — these close first."
            auctions={feed.endingSoon}
            testid="home-ending-soon"
            emptyTitle="Nothing is ending right now"
            emptyDescription="When auctions enter their final stretch they'll line up here."
          />
          <AuctionRail
            title="Live now"
            description="Bidding is open on these auctions."
            auctions={feed.live}
            testid="home-live"
            emptyTitle="No live auctions right now"
            emptyDescription="Nothing is open for bidding at this moment — new auctions show up here as soon as they go live."
          />
          <AuctionRail
            title="Recently listed"
            description="Fresh listings, newest first."
            auctions={feed.recent}
            testid="home-recent"
            emptyTitle="No listings yet"
            emptyDescription="Be the first — list an item and it will appear here."
          />
        </div>
      )}
    </div>
  );
}
