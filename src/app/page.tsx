import Link from "next/link";
import type { Metadata } from "next";
import { Gavel, TriangleAlert } from "lucide-react";

import { getHomeFeed } from "@/server/queries";
import { EmptyState } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";
import { HomeHero } from "@/components/home/home-hero";
import { CategoryChips } from "@/components/home/category-chips";
import { AuctionRail } from "@/components/home/auction-rail";

/**
 * The homepage carries the site's search positioning explicitly: the title is
 * absolute so the "%s · BidBlitz" template cannot append the brand twice, and
 * the description says what a searcher typed (online auctions, Zimbabwe)
 * without the visible hero having to read like a keyword list.
 */
export const metadata: Metadata = {
  title: { absolute: "Online Auctions in Zimbabwe | BidBlitz" },
  description:
    "Buy and sell through live online auctions in Zimbabwe on BidBlitz. List an item, bid in real time, and win when the clock runs out. One clear 5% seller fee on auctions that sell.",
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

  const marketplaceEmpty =
    feed.live.length === 0 &&
    feed.endingSoon.length === 0 &&
    feed.recent.length === 0;

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
      ) : marketplaceEmpty ? (
        /* A marketplace with nothing in it must not look broken, and must not
           look like it is hiding a catalogue either. One honest panel with two
           working ways forward, instead of three rails saying the same thing. */
        <EmptyState
          icon={Gavel}
          title="No auctions are listed yet"
          description={
            "BidBlitz is open, but no one has listed an item yet. " +
            "Sellers can publish an auction in a couple of minutes, and it appears here " +
            "the moment it goes live. If you come back later, anything currently open for " +
            "bidding is on this page and under Browse."
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button asChild>
                <Link href="/sell">List an item</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/browse">Browse auctions</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-10">
          <AuctionRail
            title="Ending soon"
            description="The clock is running. These close first."
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
            emptyDescription="Nothing is open for bidding at this moment. New auctions appear here as soon as they go live."
            emptyAction={
              <Button asChild variant="outline">
                <Link href="/browse">Browse everything</Link>
              </Button>
            }
          />
          <AuctionRail
            title="Recently listed"
            description="Fresh listings, newest first."
            auctions={feed.recent}
            testid="home-recent"
            emptyTitle="No listings yet"
            emptyDescription="Be the first to list something. It will appear here."
            emptyAction={
              <Button asChild>
                <Link href="/sell">List an item</Link>
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
