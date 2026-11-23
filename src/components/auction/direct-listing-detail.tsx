import { BackLink } from "@/components/ui/back-link";
import Link from "next/link";
import { Clock3, MapPin, MessageCircle, ShieldCheck } from "lucide-react";

import { ImageGallery, type GalleryImage } from "@/components/auction/image-gallery";
import { Money } from "@/components/auction/money";
import { ReportDialog } from "@/components/auction/report-dialog";
import { SellerCard } from "@/components/auction/seller-card";
import { ListingDealButtons } from "@/components/auction/listing-deal-buttons";
import { ServiceReviewList } from "@/components/auction/service-review-list";
import { ShareButton } from "@/components/auction/share-button";
import { ConditionBadge, StatusBadge } from "@/components/auction/status-badge";
import { WatchButton } from "@/components/auction/watch-button";
import { Button } from "@/components/ui/button";
import { ListingContactReveal } from "@/components/auction/listing-contact-reveal";
import { fulfilmentMethodLabels } from "@/lib/validation";
import { publicListingLocation } from "@/lib/listing-display";
import { listedAge } from "@/lib/discovery";
import { ListingDiscovery } from "@/components/marketplace/discovery-sections";
import type { AuctionCardData } from "@/server/queries";
import type { getAuctionDetail } from "@/server/queries";

type Listing = NonNullable<Awaited<ReturnType<typeof getAuctionDetail>>>;

export function DirectListingDetail({ detail, images, related, moreFromSeller }: {
  detail: Listing;
  images: GalleryImage[];
  related: AuctionCardData[];
  moreFromSeller: AuctionCardData[];
}) {
  const { auction, viewerId, watched } = detail;
  const isOwner = viewerId === auction.seller_id;
  const isAvailable = auction.status === "LISTED";
  const age = listedAge(auction.listed_at);

  return (
    <div className="page-container py-7 sm:py-12">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <BackLink href="/browse">Browse listings</BackLink>
        <div role="group" aria-label="Listing actions" className="flex items-center gap-2">
          {!isOwner && (isAvailable || watched) && <WatchButton auctionId={auction.id} initialWatched={watched} viewerId={viewerId} compact />}
          <ShareButton auctionId={auction.id} title={auction.title} compact />
        </div>
      </div>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <ImageGallery images={images} imageCount={auction.image_count} title={auction.title} />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <h1 data-testid="auction-title" className="text-3xl font-bold tracking-tight break-words">{auction.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={auction.status} />
              {auction.listing_kind !== "SERVICE" && <ConditionBadge condition={auction.condition} />}

            </div>
          </div>

          <section aria-labelledby="listing-price" className="space-y-3">
            {auction.status === "SOLD_DIRECT" && (
              <div role="status" className="rounded-xl border border-border bg-muted/70 px-4 py-3">
                <p className="font-semibold text-foreground">Sold — this item is no longer available.</p>
                <p className="mt-1 text-sm text-muted-foreground">The seller has marked this listing as sold. You can still view the details, but new offers and contact requests are closed.</p>
              </div>
            )}
            <div>
              <h2 id="listing-price" className="text-sm font-medium text-muted-foreground">{auction.listing_kind === "SERVICE" ? "Starting price" : "Asking price"}</h2>
              <p className="text-3xl font-bold tracking-tight"><Money minor={auction.starting_bid_minor} currency={auction.currency} /></p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid="listing-time-location">
                {age && <span className="inline-flex items-center gap-1"><Clock3 className="size-4" aria-hidden /> Listed {age}</span>}
                <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden /> {publicListingLocation(auction.location)}</span>
              </p>
            </div>
            {isAvailable && !isOwner && (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="listing-primary-actions">
                <Button asChild size="lg" variant="outline"
                  className="min-h-12 w-full border-slate-900 bg-slate-900 font-semibold text-white shadow-md hover:bg-slate-800 hover:text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white">
                  <Link href={`/messages/new?listing=${auction.id}`}>
                    <MessageCircle aria-hidden /> Message seller
                  </Link>
                </Button>
                <ListingDealButtons listingId={auction.id}
                  kind={auction.listing_kind === "SERVICE" ? "SERVICE" : "SALE"}
                  title={auction.title} location={publicListingLocation(auction.location)}
                  thumbnailSrc={images[0]?.url ?? null} askingMinor={String(auction.starting_bid_minor)}
                  currency={auction.currency} signedIn={Boolean(viewerId)} />
              </div>
            )}
            {isOwner ? (
              <Button asChild variant="outline"><Link href={`/sell/${auction.id}`}>Manage listing</Link></Button>
            ) : isAvailable ? (
              <ListingContactReveal
                listingId={auction.id}
                listingTitle={auction.title}
                signedIn={Boolean(viewerId)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{auction.status === "SOLD_DIRECT" ? "Sold — no new enquiries are being accepted." : "This listing is no longer available."}</p>
            )}
            <section aria-labelledby="listing-description" className="space-y-2 border-t pt-5">
              <h2 id="listing-description" className="font-semibold">{auction.listing_kind === "SERVICE" ? "About this service" : "About this item"}</h2>
              <p className="break-words whitespace-pre-line leading-7 text-muted-foreground">{auction.description}</p>
            </section>
          </section>

          <SellerCard seller={auction.seller} business={auction.business} />
          {auction.listing_kind === "SERVICE" && <ServiceReviewList listingId={auction.id} />}

          {auction.fulfilment_method && <section className="space-y-1" aria-labelledby="listing-handover">
            <h2 id="listing-handover" className="font-semibold">{fulfilmentMethodLabels[auction.fulfilment_method]}</h2>
            {auction.fulfilment_notes && <p className="break-words text-sm text-muted-foreground">{auction.fulfilment_notes}</p>}
          </section>}

          {isAvailable && !isOwner && <p className="flex gap-2 text-sm leading-6 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            Meet in a public place, inspect the item before paying, and keep your mobile wallet PIN private.
          </p>}
          <ReportDialog auctionId={auction.id} />
        </div>
      </div>
      <ListingDiscovery listing={{ id: auction.id, title: auction.title, location: auction.location }}
        related={related} moreFromSeller={moreFromSeller} />
    </div>
  );
}
