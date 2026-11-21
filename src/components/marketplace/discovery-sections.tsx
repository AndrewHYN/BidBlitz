import Link from "next/link";
import { ArrowRight, Compass, MapPin, Search, Sparkles } from "lucide-react";
import { AuctionCard } from "@/components/auction/auction-card";
import { knownListingTown, suggestedSearches } from "@/lib/discovery";
import { publicListingLocation } from "@/lib/listing-display";
import { MARKETPLACE_TOWNS } from "@/lib/marketplace-location";
import { groupedCategories } from "@/lib/category-taxonomy";
import type { AuctionCardData } from "@/server/queries";

function SearchLinks({ listings }: { listings: readonly { id: string; title: string }[] }) {
  const searches = suggestedSearches(listings, 6);
  if (!searches.length) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="discovery-searches">
      {searches.map((search) => (
        <Link key={search.href} href={search.href}
          className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-border/70 bg-muted/70 px-3.5 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{search.label}</span>
        </Link>
      ))}
    </div>
  );
}

/** Home discovery is populated from live inventory. No synthetic products or popularity claims. */
export function HomeDiscovery({
  listings, categories,
}: {
  listings: AuctionCardData[];
  categories: Array<{ slug: string; name: string }>;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card px-4 py-5 shadow-sm sm:px-6"
      aria-labelledby="home-discovery-heading" data-testid="home-discovery">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="home-discovery-heading" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Compass className="size-5 text-primary" aria-hidden /> Keep exploring
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Try a search or browse another part of the marketplace.</p>
        </div>
        <Link href="/browse" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary hover:underline">
          All listings <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <SearchLinks listings={listings} />
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {groupedCategories(categories, "SALE").map((section) => section.categories[0]).filter(Boolean).slice(0, 7).map((category) => (
            <Link key={category.slug} href={"/browse?category=" + encodeURIComponent(category.slug)}
              className="inline-flex min-h-10 items-center rounded-xl border bg-background px-3 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
              {category.name}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ListingRail({ title, items, id }: { title: string; items: AuctionCardData[]; id: string }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-xl font-bold tracking-tight">{title}</h2>
        <Link href="/browse" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">
          See more <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3" data-testid={id}>
        {items.map((item) => (
          <AuctionCard key={item.id} auction={item} compact className="w-48 shrink-0 snap-start sm:w-56" />
        ))}
      </div>
    </section>
  );
}

/** Extends a listing naturally when the marketplace has only a few real posts. */
export function ListingDiscovery({
  listing, related, moreFromSeller,
}: {
  listing: { id: string; title: string; location: string | null };
  related: AuctionCardData[];
  moreFromSeller: AuctionCardData[];
}) {
  const town = knownListingTown(listing.location);
  const place = publicListingLocation(listing.location);
  const coordinates = MARKETPLACE_TOWNS.find(([name]) => name === town);
  const mapSrc = coordinates
    ? "https://www.openstreetmap.org/export/embed.html?bbox=" +
      (coordinates[2] - 0.12) + "," + (coordinates[1] - 0.09) + "," +
      (coordinates[2] + 0.12) + "," + (coordinates[1] + 0.09) +
      "&layer=mapnik&marker=" + coordinates[1] + "," + coordinates[2]
    : null;
  return (
    <div className="mt-10 space-y-9 border-t pt-8" data-testid="listing-discovery">
      <ListingRail id="listing-related" title="More listings to explore" items={related} />
      <section aria-labelledby="listing-search-heading" className="space-y-3">
        <div>
          <h2 id="listing-search-heading" className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Sparkles className="size-5 text-primary" aria-hidden /> Explore related searches
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Search terms based on listings posted on BidBlitz.</p>
        </div>
        <SearchLinks listings={[listing, ...related, ...moreFromSeller]} />
      </section>
      {place !== "Location not specified" && (
        <section aria-labelledby="listing-location-heading" className="space-y-3">
          <h2 id="listing-location-heading" className="text-xl font-bold tracking-tight">Listing location</h2>
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {mapSrc && <iframe title={"Approximate map of " + town} loading="lazy" referrerPolicy="no-referrer"
              className="h-40 w-full border-0 sm:h-48" src={mapSrc} />}
            <div className="flex items-center gap-3 p-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-primary">
              <MapPin className="size-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{place}</p>
              <p className="text-sm text-muted-foreground">Approximate area provided by the seller, not a pickup address</p>
            </div>
            {town && (
              <Link href={"/browse?location=" + encodeURIComponent(town)} className="inline-flex min-h-10 shrink-0 items-center text-sm font-semibold text-primary hover:underline">
                Nearby <ArrowRight aria-hidden className="ml-1 size-4" />
              </Link>
            )}
            </div>
          </div>
        </section>
      )}
      <ListingRail id="listing-more-from-seller" title="More from this seller" items={moreFromSeller} />
      {!related.length && !moreFromSeller.length && (
        <p className="text-sm text-muted-foreground">
          Looking for more? <Link href="/browse" className="font-semibold text-primary underline underline-offset-4">Explore all current listings</Link>.
        </p>
      )}
    </div>
  );
}
