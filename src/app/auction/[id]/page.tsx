import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, ShieldCheck } from "lucide-react";

import { getAuctionDetail, imageUrlFor } from "@/server/queries";
import { isPaymentProviderConfigured } from "@/server/payments/config";
import { nextMinimumBid } from "@/lib/money";
import { SITE_URL } from "@/lib/site-url";
import {
  auctionStructuredData,
  serializeJsonLd,
} from "@/lib/structured-data";
import { ImageGallery, type GalleryImage } from "@/components/auction/image-gallery";
import { AuctionDetailLive } from "@/components/auction/auction-detail-live";
import { BidHistory } from "@/components/auction/bid-history";
import { Money } from "@/components/auction/money";
import { ReportDialog } from "@/components/auction/report-dialog";
import { SellerCard } from "@/components/auction/seller-card";
import { ShareButton } from "@/components/auction/share-button";
import { WatchButton } from "@/components/auction/watch-button";
import { ConditionBadge } from "@/components/auction/status-badge";
import { fulfilmentMethodLabels } from "@/lib/validation";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await getAuctionDetail(id);
  if (!detail) {
    // The real 404 status is produced in `src/proxy.ts` (this segment's
    // loading boundary would otherwise stream a 200 shell first — see
    // docs/loading.md "Status codes"). This is the fail-open path: correct
    // title + noindex if the proxy check could not run.
    return { title: "Auction not found", robots: { index: false } };
  }

  const description = detail.auction.description.slice(0, 160);
  const cover = [...detail.auction.auction_images]
    .filter((image) => image.storage_path)
    .sort((a, b) => a.position - b.position)[0];
  const coverUrl = cover ? imageUrlFor(cover.storage_path) : null;

  return {
    title: detail.auction.title,
    description,
    alternates: { canonical: `/auction/${detail.auction.id}` },
    openGraph: {
      type: "website",
      siteName: "BidBlitz",
      title: detail.auction.title,
      description,
      url: `/auction/${detail.auction.id}`,
      ...(coverUrl ? { images: [{ url: coverUrl }] } : {}),
    },
    // Explicit twitter fields: the card type alone would fall back to the
    // site-wide defaults, losing the auction's own title/description/image
    // in the one place sharing actually happens.
    twitter: {
      card: "summary_large_image",
      title: detail.auction.title,
      description,
      ...(coverUrl ? { images: [coverUrl] } : {}),
    },
  };
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

export default async function AuctionPage({ params }: Props) {
  const { id } = await params;
  const detail = await getAuctionDetail(id);
  if (!detail) notFound();

  const { auction, bids, viewerId, watched, myHighestBidMinor, transaction } = detail;

  const images: GalleryImage[] = [...auction.auction_images]
    .sort((a, b) => a.position - b.position)
    .flatMap((image) => {
      const url = imageUrlFor(image.storage_path);
      return url ? [{ id: image.id, url, position: image.position }] : [];
    });

  // The floor, computed once on the server with the shared bigint helper; the
  // live panel re-derives the same value for display as facts arrive.
  const nextMinMinor = nextMinimumBid(
    auction.current_bid_minor === null ? null : BigInt(auction.current_bid_minor),
    BigInt(auction.starting_bid_minor),
    BigInt(auction.bid_increment_minor)
  ).toString();

  const winningBid = bids.find((bid) => bid.is_winning) ?? null;
  const winningBidderName = winningBid?.bidder
    ? winningBid.bidder.display_name || winningBid.bidder.username
    : null;

  const listedOn = new Date(auction.created_at).toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const fulfilmentLabel = auction.fulfilment_method
    ? fulfilmentMethodLabels[auction.fulfilment_method]
    : "Not specified";

  // Built from the same row the page renders from, so the markup can never
  // advertise a price, an image or a state the visible page disagrees with.
  const structuredData = auctionStructuredData({
    siteUrl: SITE_URL,
    id: auction.id,
    title: auction.title,
    description: auction.description,
    status: auction.status,
    currency: auction.currency,
    currentBidMinor: auction.current_bid_minor,
    startingBidMinor: auction.starting_bid_minor,
    endsAt: auction.ends_at,
    categoryName: auction.categories?.name ?? null,
    categorySlug: auction.categories?.slug ?? null,
    imageUrl: images[0]?.url ?? null,
  });

  return (
    <div className="page-container py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* media */}
        <ImageGallery
          images={images}
          imageCount={auction.image_count}
          title={auction.title}
        />

        {/* title + live panel + seller */}
        <div className="space-y-4">
          <div className="space-y-2">
            <h1
              data-testid="auction-title"
              className="text-2xl font-semibold tracking-tight break-words text-balance sm:text-3xl"
            >
              {auction.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {auction.categories && (
                <Link
                  href={`/browse?category=${encodeURIComponent(auction.categories.slug)}`}
                  className="rounded bg-muted px-2 py-0.5 text-foreground transition-colors hover:text-primary"
                >
                  {auction.categories.name}
                </Link>
              )}
              <ConditionBadge condition={auction.condition} />
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{auction.location}</span>
              </span>
            </div>
          </div>

          <AuctionDetailLive
            auctionId={auction.id}
            currency={auction.currency}
            serverUpdatedAt={auction.updated_at}
            status={auction.status}
            endsAt={auction.ends_at}
            currentBidMinor={auction.current_bid_minor}
            bidCount={auction.bid_count}
            nextMinMinor={nextMinMinor}
            startsAt={auction.starts_at}
            sellerId={auction.seller_id}
            viewerId={viewerId}
            winnerId={auction.winner_id}
            winningBidMinor={auction.winning_bid_minor}
            winningBidderName={winningBidderName}
            startingBidMinor={auction.starting_bid_minor}
            bidIncrementMinor={auction.bid_increment_minor}
            myHighestBidMinor={myHighestBidMinor}
            transactionStatus={transaction?.status ?? null}
            paymentConfigured={isPaymentProviderConfigured()}
          />

          <div className="flex flex-wrap items-center gap-2">
            <WatchButton
              auctionId={auction.id}
              initialWatched={watched}
              viewerId={viewerId}
            />
            <ShareButton auctionId={auction.id} title={auction.title} />
          </div>

          <SellerCard seller={auction.seller} />
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-8">
          {/* The seller's description is content, not an object, so it does not
              get a card. It was a bordered box holding one paragraph, which is
              the "unrelated paragraph, own box" failure — and on a page whose
              right-hand column is the bid panel, an extra frame here competed
              with the thing a bidder came for. */}
          <section aria-labelledby="about-item">
            <h2
              id="about-item"
              className="mb-3 text-base font-semibold tracking-tight"
            >
              About this item
            </h2>
            <p className="text-[0.9375rem] leading-[1.7] break-words whitespace-pre-line text-muted-foreground text-pretty">
              {auction.description}
            </p>
          </section>

          <section aria-labelledby="fulfilment">
            <h2
              id="fulfilment"
              className="mb-3 text-base font-semibold tracking-tight"
            >
              Collection & delivery
            </h2>
            <div className="space-y-3 text-[0.9375rem] leading-[1.7] text-muted-foreground text-pretty">
              <p>
                <strong className="text-foreground">{fulfilmentLabel}.</strong>
                {auction.fulfilment_notes ? ` ${auction.fulfilment_notes}` : ""}
              </p>
              <p>
                BidBlitz does not ship items or set delivery prices. After the
                auction closes, the buyer and seller get a private message thread
                to confirm collection or delivery details before handover.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="meet-safely"
            className="rounded-xl border border-live/25 bg-live/5 p-5"
          >
            <h2 id="meet-safely" className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <ShieldCheck className="size-4 text-live" aria-hidden />
              Meet and trade safely
            </h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
              <li>• For portable items, meet in a busy, well-lit public place when possible.</li>
              <li>• Inspect the item before you confirm that you received it.</li>
              <li>• Keep transaction messages inside BidBlitz so there is a record.</li>
              <li>• Never share passwords, PINs or one-time security codes.</li>
              <li>• Use the BidBlitz payment flow. Be cautious of payment links sent in messages.</li>
              <li>• For home collection, arrange daylight pickup and have another adult present.</li>
            </ul>
          </section>

          <BidHistory bids={bids} currency={auction.currency} />
        </div>

        {/*
          Only the terms that are not already on screen.

          Category, condition and location were shown twice — as chips under the
          title where they belong, and again as rows here — and the starting bid
          was shown twice too, once in the bid panel. Repeating a fact in two
          places on one page makes a reader check which is current. What is left
          is what a bidder needs and cannot see anywhere else: what each extra
          bid costs, and when the listing was published.
        */}
        <aside className="space-y-4 self-start lg:sticky lg:top-24">
          <div className="rounded-xl border border-border/80 bg-card p-5 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.5)]">
            <h2 className="mb-2 text-base font-semibold tracking-tight">
              Bidding terms
            </h2>
            <dl className="divide-y">
              <FactRow label="Bid increment">
                <Money
                  minor={auction.bid_increment_minor}
                  currency={auction.currency}
                />
              </FactRow>
              <FactRow label="Fair ending">
                A bid in the final {auction.anti_snipe_window_seconds}s can add {auction.anti_snipe_extension_seconds}s
              </FactRow>
              <FactRow label="Listed">{listedOn}</FactRow>
            </dl>
          </div>

          <ReportDialog auctionId={auction.id} />
        </aside>
      </div>
    </div>
  );
}
