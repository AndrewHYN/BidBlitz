import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Images, Rocket, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuctionDetail, imageUrlFor } from "@/server/queries";
import { EmptyState, PageHeader, SectionHeading } from "@/components/auction/page-header";
import { LiveStatus } from "@/components/auction/live-status";
import { Money } from "@/components/auction/money";
import { ConditionBadge } from "@/components/auction/status-badge";
import { DURATIONS, conditionLabels } from "@/lib/validation";
import { isClosed } from "@/lib/auction-status";
import { ImageUploader } from "@/components/sell/image-uploader";
import { PublishButton } from "@/components/sell/publish-button";
import { CancelAuctionButton } from "@/components/sell/cancel-auction-button";
import { DeleteDraftButton } from "@/components/sell/delete-draft-button";

export const metadata: Metadata = {
  title: "Finish your listing",
  description: "Add photos, review the terms and publish your BidBlitz auction.",
};

/** Statuses where photos can still be attached (mirrors the storage policy). */
const EDITABLE_STATUSES = new Set(["DRAFT", "SCHEDULED", "LIVE"]);

export default async function SellDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/sell/${id}`);

  // RLS already hides other people's drafts; this second check turns "not
  // yours" into a clean 404 instead of leaking that the id exists.
  const detail = await getAuctionDetail(id);
  if (!detail) notFound();
  const { auction } = detail;
  if (auction.seller_id !== user.id) notFound();

  const images = [...auction.auction_images]
    .sort((a, b) => a.position - b.position)
    .map((image) => ({
      key: image.id,
      storagePath: image.storage_path,
      url: imageUrlFor(image.storage_path) ?? "",
    }));

  const editable = EDITABLE_STATUSES.has(auction.status);
  const durationLabel =
    DURATIONS.find((d) => d.seconds === auction.duration_seconds)?.label ??
    `${auction.duration_seconds} seconds`;
  const canCancel = auction.bid_count === 0 && !isClosed(auction.status);
  const canDelete = auction.status === "DRAFT" && auction.bid_count === 0;

  return (
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title={auction.title}
        description="Add photos, check the terms, then start the blitz."
        actions={
          <Link
            href="/dashboard/selling"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to selling
          </Link>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="draft-terms-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="draft-terms-heading" className="text-base font-semibold tracking-tight">
                Listing summary
              </h2>
              <span data-testid="draft-status">
                <LiveStatus status={auction.status} endsAt={auction.ends_at} />
              </span>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">{auction.description}</p>

            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Starting bid
                </dt>
                <dd className="text-lg font-semibold">
                  <Money minor={auction.starting_bid_minor} currency={auction.currency} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Bid increment
                </dt>
                <dd className="text-lg font-semibold">
                  <Money minor={auction.bid_increment_minor} currency={auction.currency} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Duration</dt>
                <dd className="text-sm font-medium">{durationLabel}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Bids so far</dt>
                <dd className="text-sm font-medium" data-numeric>
                  {auction.bid_count}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Anti-snipe window
                </dt>
                <dd className="text-sm font-medium">
                  {auction.anti_snipe_window_seconds}s before the end
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Anti-snipe extension
                </dt>
                <dd className="text-sm font-medium">
                  +{auction.anti_snipe_extension_seconds}s per last-second bid
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Condition</dt>
                <dd>
                  <ConditionBadge condition={auction.condition} />
                  <span className="ml-2 text-sm text-muted-foreground">
                    {conditionLabels[auction.condition] ?? auction.condition}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Location</dt>
                <dd className="text-sm font-medium">{auction.location}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="draft-photos-heading">
            <SectionHeading
              title={
                <span id="draft-photos-heading" className="inline-flex items-center gap-2">
                  <Images className="size-4 text-muted-foreground" aria-hidden />
                  Photos
                </span>
              }
            />
            <p className="mt-1 text-sm text-muted-foreground">
              At least one photo is required before publishing.
            </p>
            <div className="mt-4">
              {editable ? (
                <ImageUploader auctionId={auction.id} images={images} />
              ) : images.length > 0 ? (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {images.map((image, index) => (
                    <li
                      key={image.key}
                      className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted"
                    >
                      {/* Supabase public bucket; plain img keeps remote-pattern config out of the build. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={`Photo ${index + 1} of ${images.length}`}
                        className="size-full object-cover"
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={Images}
                  title="No photos yet"
                  description="This auction is closed, so its photos are read-only."
                />
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="draft-publish-heading">
            <SectionHeading
              title={
                <span id="draft-publish-heading" className="inline-flex items-center gap-2">
                  <Rocket className="size-4 text-muted-foreground" aria-hidden />
                  Publish
                </span>
              }
            />
            <div className="mt-4">
              <PublishButton
                auctionId={auction.id}
                imageCount={auction.image_count}
                status={auction.status}
                endsAt={auction.ends_at}
              />
            </div>
          </section>

          {(canCancel || canDelete) && (
            <section
              className="rounded-xl border border-destructive/25 bg-card p-6 shadow-sm"
              aria-labelledby="draft-danger-heading"
            >
              <SectionHeading
                title={
                  <span id="draft-danger-heading" className="inline-flex items-center gap-2">
                    <TriangleAlert className="size-4 text-destructive" aria-hidden />
                    Remove this listing
                  </span>
                }
              />
              <p className="mt-1 text-sm text-muted-foreground">
                {auction.bid_count > 0
                  ? "People have bid, so this listing can’t be removed."
                  : "Both actions are permanent."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {canCancel && (
                  <CancelAuctionButton auctionId={auction.id} title={auction.title} />
                )}
                {canDelete && <DeleteDraftButton auctionId={auction.id} />}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
