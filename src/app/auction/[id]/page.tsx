import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";

import { getAuctionDetail, imageUrlFor } from "@/server/queries";
import { isPaymentProviderConfigured } from "@/server/payments/config";
import { nextMinimumBid } from "@/lib/money";
import { conditionLabels } from "@/lib/validation";
import { ImageGallery, type GalleryImage } from "@/components/auction/image-gallery";
import { AuctionDetailLive } from "@/components/auction/auction-detail-live";
import { BidHistory } from "@/components/auction/bid-history";
import { Money } from "@/components/auction/money";
import { ReportDialog } from "@/components/auction/report-dialog";
import { SellerCard } from "@/components/auction/seller-card";
import { ShareButton } from "@/components/auction/share-button";
import { WatchButton } from "@/components/auction/watch-button";
import { ConditionBadge } from "@/components/auction/status-badge";
import { SectionHeading } from "@/components/auction/page-header";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await getAuctionDetail(id);
  if (!detail) {
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

  return (
    <div className="page-container py-10 sm:py-14">
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
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border bg-card p-5">
            <SectionHeading title="About this item" />
            <p className="text-sm leading-relaxed break-words whitespace-pre-line text-muted-foreground">
              {auction.description}
            </p>
          </section>

          <BidHistory bids={bids} currency={auction.currency} />
        </div>

        <aside className="space-y-4 self-start rounded-xl border bg-card p-5 lg:sticky lg:top-24">
          <SectionHeading title="Item details" />
          <dl className="divide-y">
            <FactRow label="Category">
              {auction.categories?.name ?? "Uncategorized"}
            </FactRow>
            <FactRow label="Condition">
              {conditionLabels[auction.condition] ?? auction.condition}
            </FactRow>
            <FactRow label="Location">{auction.location}</FactRow>
            <FactRow label="Starting bid">
              <Money
                minor={auction.starting_bid_minor}
                currency={auction.currency}
              />
            </FactRow>
            <FactRow label="Bid increment">
              <Money
                minor={auction.bid_increment_minor}
                currency={auction.currency}
              />
            </FactRow>
            <FactRow label="Listed">{listedOn}</FactRow>
          </dl>

          <div className="border-t pt-3">
            <ReportDialog auctionId={auction.id} />
          </div>
        </aside>
      </div>
    </div>
  );
}
