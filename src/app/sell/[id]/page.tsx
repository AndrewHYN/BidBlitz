import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye, Images, Rocket, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuctionDetail, getFeeBps, imageUrlFor } from "@/server/queries";
import { EmptyState, PageHeader, SectionHeading } from "@/components/auction/page-header";
import { LiveStatus } from "@/components/auction/live-status";
import { Money } from "@/components/auction/money";
import { feePercentLabel } from "@/lib/money";
import { ConditionBadge } from "@/components/auction/status-badge";
import { DURATIONS, conditionLabels } from "@/lib/validation";
import { isClosed } from "@/lib/auction-status";
import { ImageUploader } from "@/components/sell/image-uploader";
import { PublishButton } from "@/components/sell/publish-button";
import { FulfilmentEditor } from "@/components/sell/fulfilment-editor";
import { CancelAuctionButton } from "@/components/sell/cancel-auction-button";
import {
  RequestCancellationButton,
  WithdrawCancellationButton,
  WithdrawReviewButton,
} from "@/components/sell/cancellation-request-button";
import {
  isPaymentProviderConfigured,
  paymentProviderDisplayName,
} from "@/server/payments/config";
import { paymentsRuntimeEnabled } from "@/server/payments/runtime";
import { DeleteDraftButton } from "@/components/sell/delete-draft-button";
import { PromotionRequest } from "@/components/sell/promotion-request";

export const metadata: Metadata = {
  title: "Finish your listing",
  description: "Add photos, review the terms and publish your BidBlitz auction.",
  robots: { index: false, follow: false },
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
  const [feeBps, serverNowResult, payoutSetupResult, paymentsEnabled] = await Promise.all([
    getFeeBps(),
    supabase.rpc("server_now"),
    supabase.rpc("my_payout_setup"),
    paymentsRuntimeEnabled(),
  ]);
  const serverNow = typeof serverNowResult.data === "string" ? serverNowResult.data : null;
  const payoutSetup = payoutSetupResult.data?.[0] ?? null;
  const payoutReady = payoutSetup?.ready === true;
  const activePromotionUntil =
    auction.featured_until &&
    serverNow &&
    new Date(auction.featured_until).getTime() > new Date(serverNow).getTime()
      ? auction.featured_until
      : null;

  // Name the configured provider, or nothing: this page must not claim a
  // payment rail the deployment does not have.
  const providerName = isPaymentProviderConfigured()
    ? paymentProviderDisplayName()
    : null;

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

  // The seller's own pending business, if any: a cancellation request waiting
  // on the team, or a review holding the listing. Both are the seller's rows
  // (RLS), so a missing row here simply means nothing pending.
  const [
    { data: pendingRequest },
    { data: pendingReview },
    { data: pendingPromotion },
    { data: promotionOffers },
  ] = await Promise.all([
    supabase
      .from("auction_cancellation_requests")
      .select("id, reason_code, created_at")
      .eq("auction_id", auction.id)
      .eq("status", "PENDING")
      .maybeSingle(),
    supabase
      .from("listing_reviews")
      .select("id, created_at")
      .eq("auction_id", auction.id)
      .eq("status", "PENDING")
      .maybeSingle(),
    supabase
      .from("promotion_requests")
      .select("id, requested_days, requested_at, quoted_price_minor, currency")
      .eq("auction_id", auction.id)
      .eq("status", "PENDING")
      .maybeSingle(),
    supabase
      .from("promotion_settings")
      .select("days, price_minor, currency, enabled")
      .order("days", { ascending: true }),
  ]);
  // A with-bids LIVE auction cannot be cancelled directly; it gets a request
  // instead. PAUSED auctions get neither: the hold lifts only through admin.
  const canRequestCancellation =
    auction.status === "LIVE" && auction.bid_count > 0 && !pendingRequest;

  return (
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title={auction.title}
        description={
          auction.status === "DRAFT"
            ? "Your draft is saved. Add strong photos, check the handover details, then review and publish."
            : "Review this listing’s current status, photos and auction details."
        }
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href={`/auction/${auction.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Eye className="size-4" aria-hidden />
              Preview as a buyer
            </Link>
            <Link
              href="/dashboard/selling"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back to selling
            </Link>
          </div>
        }
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="draft-terms-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Review
                </p>
                <h2 id="draft-terms-heading" className="mt-1 text-lg font-bold tracking-tight">
                  Check what bidders will see
                </h2>
              </div>
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
                  Last-second protection
                </dt>
                <dd className="text-sm font-medium">
                  {auction.anti_snipe_window_seconds}s before the end
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Time added after a protected bid
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
                  <Images className="size-4 text-primary" aria-hidden />
                  Step 2 · Add clear photos
                </span>
              }
            />
            <p className="mt-1 text-sm text-muted-foreground">
              Use clear, well-lit photos of the actual item. At least one is required before publishing.
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
                  description={
                    auction.status === "PENDING_REVIEW"
                      ? "This listing is under review, so its photos are read-only for now. Withdraw the review to edit."
                      : auction.status === "PAUSED"
                        ? "This auction is paused, so its photos are read-only until it resumes."
                        : "This auction is closed, so its photos are read-only."
                  }
                />
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {auction.status === "DRAFT" && (
            <section
              className="rounded-xl border bg-card p-6 shadow-sm"
              aria-labelledby="draft-fulfilment-heading"
            >
              <SectionHeading
                title={<span id="draft-fulfilment-heading">Step 3 · Confirm handover</span>}
              />
              <p className="mt-1 text-sm text-muted-foreground">
                Make collection or delivery clear before anyone commits to a bid.
              </p>
              <div className="mt-4">
                <FulfilmentEditor
                  auctionId={auction.id}
                  initialMethod={auction.fulfilment_method}
                  initialNotes={auction.fulfilment_notes}
                />
              </div>
            </section>
          )}

          <section className="rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="draft-publish-heading">
            <SectionHeading
              title={
                <span id="draft-publish-heading" className="inline-flex items-center gap-2">
                  <Rocket className="size-4 text-primary" aria-hidden />
                  Step 4 · Review and publish
                </span>
              }
            />
            <p className="mt-1 text-sm text-muted-foreground">
              When you publish, bidding starts immediately and the auction terms lock.
            </p>
            <div className="mt-4">
              <PublishButton
                auctionId={auction.id}
                title={auction.title}
                imageCount={auction.image_count}
                hasFulfilment={auction.fulfilment_method !== null}
                payoutReady={payoutReady}
                status={auction.status}
                endsAt={auction.ends_at}
              />
            </div>
            <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
              <p className="text-sm font-medium">Your obligations on this listing</p>
              <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted-foreground">
                <li>
                  Your title, description and photos must describe the actual
                  item. Buyers are held to what you wrote, so a materially wrong
                  listing can cost you the sale.
                </li>
                <li>
                  If it sells, you must deliver or hand over what you listed to
                  the winning bidder.
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                If it sells, BidBlitz takes{" "}
                {feeBps !== null ? (
                  <strong className="font-semibold">{feePercentLabel(feeBps)}</strong>
                ) : (
                  "a platform fee"
                )}{" "}
                of the winning price from your proceeds.{" "}
                {providerName !== null && paymentsEnabled ? (
                  <>
                    The buyer pays your winning bid plus {providerName}&apos;s
                    own payment charge, which is not money you receive.
                  </>
                ) : providerName !== null ? (
                  <>
                    {providerName} is connected, but new checkout is temporarily
                    paused by BidBlitz&apos;s payment safety switch. No buyer can
                    start a new payment until it is re-enabled.
                  </>
                ) : (
                  <>
                    No payment provider is connected yet, so no money moves: when
                    one is, the buyer will pay your winning bid plus that
                    provider&apos;s own payment charge, which is not money you
                    receive.
                  </>
                )}{" "}
                Your proceeds are sent after the buyer confirms handover.
                BidBlitz does not reduce that frozen seller amount again after the sale.
              </p>
            </div>
          </section>

          {(auction.status === "LIVE" || auction.status === "SCHEDULED") && (
            <section
              className="rounded-xl border bg-card p-6 shadow-sm"
              aria-labelledby="draft-promotion-heading"
            >
              <SectionHeading
                title={<span id="draft-promotion-heading">Promote this auction</span>}
              />
              <p className="mt-1 text-sm text-muted-foreground">
                Promoted placement gives your auction extra visibility without changing how bidding works.
              </p>
              <div className="mt-4">
                <PromotionRequest
                  auctionId={auction.id}
                  activeUntil={activePromotionUntil}
                  pendingDays={pendingPromotion?.requested_days ?? null}
                  pendingPriceMinor={pendingPromotion?.quoted_price_minor ?? null}
                  pendingCurrency={pendingPromotion?.currency ?? null}
                  offers={(promotionOffers ?? [])
                    .filter((offer) => offer.days === 3 || offer.days === 7)
                    .map((offer) => ({
                      days: offer.days as 3 | 7,
                      priceMinor: offer.price_minor,
                      currency: offer.currency,
                      enabled: offer.enabled,
                    }))}
                />
              </div>
            </section>
          )}

          {auction.status === "PENDING_REVIEW" && (
            <section
              className="rounded-xl border bg-card p-6 shadow-sm"
              aria-labelledby="draft-review-heading"
            >
              <SectionHeading
                title={
                  <span id="draft-review-heading" className="inline-flex items-center gap-2">
                    <Eye className="size-4 text-muted-foreground" aria-hidden />
                    Under review
                  </span>
                }
              />
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingReview
                  ? "The BidBlitz team is checking this listing before it can go public. You will find the decision in your notifications."
                  : "This listing is waiting for review."}{" "}
                To edit it, withdraw the review first: withdrawing is always
                safe, and publishing again re-runs the checks.
              </p>
              {pendingReview && (
                <div className="mt-4">
                  <WithdrawReviewButton auctionId={auction.id} />
                </div>
              )}
            </section>
          )}

          {auction.status === "PAUSED" && (
            <section
              className="rounded-xl border bg-card p-6 shadow-sm"
              aria-labelledby="draft-paused-heading"
            >
              <SectionHeading
                title={
                  <span id="draft-paused-heading" className="inline-flex items-center gap-2">
                    <TriangleAlert className="size-4 text-muted-foreground" aria-hidden />
                    Paused by BidBlitz
                  </span>
                }
              />
              <p className="mt-1 text-sm text-muted-foreground">
                Bidding is disabled and the clock is stopped while the team
                reviews an issue. Your bids and history stay recorded. Only an
                admin can resume it; if you need to talk to one, use the help
                page.
              </p>
            </section>
          )}

          {pendingRequest && (
            <section
              className="rounded-xl border bg-card p-6 shadow-sm"
              aria-labelledby="draft-request-heading"
            >
              <SectionHeading
                title={
                  <span id="draft-request-heading" className="inline-flex items-center gap-2">
                    <TriangleAlert className="size-4 text-muted-foreground" aria-hidden />
                    Cancellation requested
                  </span>
                }
              />
              <p className="mt-1 text-sm text-muted-foreground">
                The team is reviewing your request. Your auction stays live
                until they decide.
              </p>
              <div className="mt-4">
                <WithdrawCancellationButton
                  requestId={(pendingRequest as { id: string }).id}
                />
              </div>
            </section>
          )}

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

          {canRequestCancellation && (
            <section
              className="rounded-xl border bg-card p-6 shadow-sm"
              aria-labelledby="draft-request-new-heading"
            >
              <SectionHeading
                title={
                  <span id="draft-request-new-heading" className="inline-flex items-center gap-2">
                    <TriangleAlert className="size-4 text-muted-foreground" aria-hidden />
                    End this auction early
                  </span>
                }
              />
              <p className="mt-1 text-sm text-muted-foreground">
                People have bid, so this listing can’t be removed directly. You
                can ask the team to end it, with a reason they can act on.
              </p>
              <div className="mt-4">
                <RequestCancellationButton
                  auctionId={auction.id}
                  title={auction.title}
                  bidCount={auction.bid_count}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
