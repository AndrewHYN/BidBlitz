import Link from "next/link";
import type { Metadata } from "next";
import { Tag, TriangleAlert } from "lucide-react";

import { getMarketplaceHome } from "@/server/queries";
import { AuctionGrid } from "@/components/auction/auction-card";
import { EmptyState } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";
import { HomeHero } from "@/components/home/home-hero";
import { CategoryChips } from "@/components/home/category-chips";

export const metadata: Metadata = {
  title: { absolute: "Buy and Sell in Zimbabwe | BidBlitz Marketplace" },
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const { listings, categories, error } = await getMarketplaceHome();

  return (
    <div className="page-container space-y-8 py-7 sm:py-12">
      <div className="space-y-5">
        <HomeHero />
        <CategoryChips categories={categories} />
      </div>
      {error ? (
        <EmptyState icon={TriangleAlert} title="We couldn’t load listings" description="Refresh the page to try again."
          action={<Button asChild variant="outline"><Link href="/">Refresh</Link></Button>} />
      ) : listings.length === 0 ? (
        <EmptyState icon={Tag} title="No listings yet" description="Have something to sell? Post it and let buyers contact you directly."
          action={<Button asChild><Link href="/sell">List an item</Link></Button>} />
      ) : (
        <section aria-labelledby="latest-listings" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="latest-listings" className="text-xl font-bold tracking-tight">Latest listings</h2>
            <Link className="text-sm font-semibold text-primary hover:underline" href="/browse">View all listings</Link>
          </div>
          <AuctionGrid items={listings} />
        </section>
      )}
    </div>
  );
}
