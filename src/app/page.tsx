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
  const { listings, otherListings, categories, error, otherError } = await getMarketplaceHome(location);

  return (
    <div className="page-container space-y-5 py-4 sm:space-y-7 sm:py-7">
      <HomeHero locationPicker={<HomeLocationPicker key={location ?? "national"} location={location} defaultLocation={defaultLocation} />} />
      <section aria-labelledby="latest-listings" className="space-y-2 border-t pt-2 sm:space-y-3">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h2 id="latest-listings" className="min-w-0 text-lg font-bold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-xl">{location ? `Latest in ${location}` : "Latest listings"}</h2>
          <CategoryChips categories={categories} />
        </div>
        {error ? (
          <EmptyState icon={TriangleAlert} title="We couldn’t load listings" description="Refresh the page to try again."
            action={<Button asChild variant="outline"><Link href="/">Refresh</Link></Button>} />
        ) : listings.length === 0 && otherListings.length > 0 ? (
          <p role="status" className="text-sm text-muted-foreground">No listings in {location} yet.</p>
        ) : listings.length === 0 ? (
          <EmptyState icon={Tag} title={location ? `No listings in ${location} yet` : "No listings yet"}
            description={location ? "Use the location pin to see listings in another area." : "Have something to sell? Post it and let buyers contact you directly."}
            action={<Button asChild><Link href="/sell">List an item</Link></Button>} />
        ) : (
          <AuctionGrid items={listings} compact />
        )}
      </section>
      {otherError && <p role="alert">Listings from other areas couldn’t load. <Link href="/browse" className="underline">Browse all listings</Link></p>}
      {otherListings.length > 0 && (
        <section aria-labelledby="other-listings" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="other-listings" className="text-xl font-bold tracking-tight">Elsewhere in Zimbabwe</h2>
            <Link className="text-sm font-semibold text-primary hover:underline" href="/browse">Browse all areas</Link>
          </div>
          <AuctionGrid items={otherListings} compact />
        </section>
      )}
    </div>
  );
}
