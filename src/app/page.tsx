import Link from "next/link";
import type { Metadata } from "next";
import { Tag, TriangleAlert } from "lucide-react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { MARKETPLACE_LOCATION_COOKIE, marketplaceLocation, normalizeMarketplaceLocation } from "@/lib/marketplace-location";
import { HomeLocationPicker } from "@/components/home/home-location-picker";

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
  const supabase = await createClient();
  const [{ data: { user } }, cookieStore] = await Promise.all([supabase.auth.getUser(), cookies()]);
  const defaultLocation = marketplaceLocation(user?.user_metadata.marketplace_location);
  const preference = cookieStore.get(MARKETPLACE_LOCATION_COOKIE)?.value;
  const location = preference === "all" ? null : normalizeMarketplaceLocation(preference) ?? defaultLocation;
  const { listings, categories, error } = await getMarketplaceHome(location);

  return (
    <div className="page-container space-y-8 py-7 sm:py-12">
      <div className="space-y-5">
        <HomeHero />
        <HomeLocationPicker key={location ?? "national"} location={location} defaultLocation={defaultLocation} />
        <CategoryChips categories={categories} />
      </div>
      {error ? (
        <EmptyState icon={TriangleAlert} title="We couldn’t load listings" description="Refresh the page to try again."
          action={<Button asChild variant="outline"><Link href="/">Refresh</Link></Button>} />
      ) : listings.length === 0 ? (
        <EmptyState icon={Tag} title={location ? `No listings in ${location} yet` : "No listings yet"}
          description={location ? "Switch locations above to see listings in another area." : "Have something to sell? Post it and let buyers contact you directly."}
          action={<Button asChild><Link href="/sell">List an item</Link></Button>} />
      ) : (
        <section aria-labelledby="latest-listings" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="latest-listings" className="text-xl font-bold tracking-tight">{location ? `Latest listings in ${location}` : "Latest listings"}</h2>
            <Link className="text-sm font-semibold text-primary hover:underline" href="/browse">View all listings</Link>
          </div>
          <AuctionGrid items={listings} />
        </section>
      )}
    </div>
  );
}
