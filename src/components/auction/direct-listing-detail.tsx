import Link from "next/link";
import { ArrowLeft, MapPin, MessageCircle, Phone, ShieldCheck } from "lucide-react";

import { ImageGallery, type GalleryImage } from "@/components/auction/image-gallery";
import { Money } from "@/components/auction/money";
import { ReportDialog } from "@/components/auction/report-dialog";
import { SellerCard } from "@/components/auction/seller-card";
import { ShareButton } from "@/components/auction/share-button";
import { ConditionBadge, StatusBadge } from "@/components/auction/status-badge";
import { WatchButton } from "@/components/auction/watch-button";
import { Button } from "@/components/ui/button";
import { CANONICAL_SITE_URL } from "@/lib/site-url";
import { fulfilmentMethodLabels } from "@/lib/validation";
import type { getAuctionDetail } from "@/server/queries";

type Listing = NonNullable<Awaited<ReturnType<typeof getAuctionDetail>>>;

export function DirectListingDetail({ detail, images }: { detail: Listing; images: GalleryImage[] }) {
  const { auction, contactPhone, viewerId, watched } = detail;
  const isOwner = viewerId === auction.seller_id;
  const isAvailable = auction.status === "LISTED";
  const canContact = isAvailable && !isOwner && Boolean(contactPhone);
  const whatsapp = contactPhone && `https://wa.me/${contactPhone.slice(1)}?text=${encodeURIComponent(
    `Hi, is "${auction.title}" still available? I saw it on BidBlitz: ${CANONICAL_SITE_URL}/auction/${auction.id}`
  )}`;

  return (
    <div className="page-container py-7 sm:py-12">
      <Link href="/browse" className="mb-5 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Browse listings
      </Link>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <ImageGallery images={images} imageCount={auction.image_count} title={auction.title} />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <h1 data-testid="auction-title" className="text-3xl font-bold tracking-tight break-words">{auction.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={auction.status} />
              <ConditionBadge condition={auction.condition} />
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0" aria-hidden /> {auction.location}
              </span>
            </div>
          </div>

          <section aria-labelledby="listing-price" className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
            <div>
              <h2 id="listing-price" className="text-sm font-medium text-muted-foreground">Asking price</h2>
              <p className="text-3xl font-bold"><Money minor={auction.starting_bid_minor} currency={auction.currency} /></p>
            </div>
            {canContact && contactPhone && whatsapp ? (
              <div className="space-y-2">
                <Button asChild size="lg" className="min-h-11 w-full">
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden /> WhatsApp seller</a>
                </Button>
                <Button asChild variant="outline" size="lg" className="min-h-11 w-full">
                  <a href={`tel:${contactPhone}`}><Phone aria-hidden /> Call {contactPhone}</a>
                </Button>
                <p className="text-sm leading-6 text-muted-foreground">Agree on cash, EcoCash, Omari or InnBucks with the seller. Payment goes directly to the seller.</p>
              </div>
            ) : isOwner ? (
              <Button asChild variant="outline"><Link href={`/sell/${auction.id}`}>Manage listing</Link></Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isAvailable ? "Seller contact is temporarily unavailable." : "This item is no longer available."}
              </p>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <WatchButton auctionId={auction.id} initialWatched={watched} viewerId={viewerId} />
            <ShareButton auctionId={auction.id} title={auction.title} />
          </div>

          <section aria-labelledby="listing-description" className="space-y-2">
            <h2 id="listing-description" className="font-semibold">About this item</h2>
            <p className="break-words whitespace-pre-line text-muted-foreground">{auction.description}</p>
          </section>

          <SellerCard seller={auction.seller} business={auction.business} />

          {auction.fulfilment_method && <section className="space-y-1" aria-labelledby="listing-handover">
            <h2 id="listing-handover" className="font-semibold">{fulfilmentMethodLabels[auction.fulfilment_method]}</h2>
            {auction.fulfilment_notes && <p className="break-words text-sm text-muted-foreground">{auction.fulfilment_notes}</p>}
          </section>}

          {canContact && <p className="flex gap-2 text-sm leading-6 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            Meet in a public place, inspect the item before paying, and keep your mobile wallet PIN private.
          </p>}
          <ReportDialog auctionId={auction.id} />
        </div>
      </div>
    </div>
  );
}
