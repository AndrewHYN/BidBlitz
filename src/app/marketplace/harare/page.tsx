import type { Metadata } from "next";
import Link from "next/link";
import { AuctionGrid } from "@/components/auction/auction-card";
import { browseListings } from "@/server/queries";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Online Marketplace in Harare | Buy and Sell Locally",
  description:
    "Browse local items for sale in Harare, Zimbabwe. Compare real seller listings, message owners directly and arrange safe collection through BidBlitz.",
  alternates: { canonical: "/marketplace/harare" },
};

export const dynamic = "force-dynamic";

export default async function HarareMarketplacePage() {
  const result = await browseListings({ kind: "SALE", location: "Harare", page: 1 });

  return (
    <div className="page-container space-y-8 py-8 sm:space-y-10 sm:py-12">
      <header className="max-w-3xl space-y-4">
        <p className="text-sm font-semibold text-primary">Zimbabwe local marketplace</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Buy and sell locally in Harare</h1>
        <p className="text-base leading-7 text-muted-foreground">
          Looking for an item close to home? Browse listings posted by independent sellers in Harare.
          Contact the seller through BidBlitz, ask about the item&apos;s condition and availability,
          and agree on a suitable meeting place before paying. BidBlitz does not collect payment
          for these direct sales.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link href="/browse?location=Harare&kind=SALE">Browse all Harare sales</Link></Button>
          <Button asChild variant="outline"><Link href="/sell">Post an item for sale</Link></Button>
        </div>
      </header>

      <section aria-labelledby="harare-listings" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="harare-listings" className="text-xl font-bold">Items for sale in Harare</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.error ? "Listings temporarily unavailable" : `${result.total} available ${result.total === 1 ? "listing" : "listings"}`}
            </p>
          </div>
          <Link href="/browse?location=Harare&kind=SALE" className="text-sm font-semibold text-primary underline underline-offset-4">View more listings</Link>
        </div>
        {result.error ? (
          <p role="alert" className="rounded-xl border bg-card p-6">We could not load listings right now. Try browsing again shortly.</p>
        ) : result.items.length > 0 ? (
          <AuctionGrid items={result.items} headingLevel="h3" />
        ) : (
          <div className="rounded-xl border bg-card p-6">
            <p>No available Harare sale listings match this view yet. Check again as sellers publish new items, or browse all locations.</p>
            <Link className="mt-3 inline-block text-sm font-semibold text-primary underline" href="/browse">Explore Zimbabwe-wide listings</Link>
          </div>
        )}
      </section>

      <section aria-labelledby="harare-marketplace-guide" className="space-y-4">
        <h2 id="harare-marketplace-guide" className="text-xl font-bold">How to shop safely in Harare</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold">Compare real listings</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Check photos, item condition and prices. Ask the seller about defects, accessories and what is included before travelling.</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold">Agree on collection</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Arrange a public, suitable meeting location and inspect the item yourself. Do not assume a listing is verified by BidBlitz.</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold">Pay the seller directly</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Use a payment method you both agree on. Confirm any mobile-money transfer in your own wallet, and never share your PIN or one-time code.</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          New to local buying? See our <Link href="/safety" className="font-medium text-primary underline">marketplace safety guide</Link>.
          Selling from another Zimbabwean city? <Link href="/for-sellers" className="font-medium text-primary underline">Learn how to list for free</Link>.
        </p>
      </section>
    </div>
  );
}
