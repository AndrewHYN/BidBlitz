import Link from "next/link";
import { ArrowUpRight, Building2, Gavel, MapPin, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuctionCardData } from "@/server/queries";
import { Money } from "@/components/auction/money";
import { ImageWithFallback } from "@/components/auction/image-with-fallback";
import { Countdown } from "@/components/auction/countdown";
import { LiveStatus } from "@/components/auction/live-status";
import { isClosed } from "@/lib/auction-status";
import { ConditionBadge } from "@/components/auction/status-badge";
import { publicListingLocation } from "@/lib/listing-display";

/**
 * The one card used on home, browse, watchlist, dashboards and profiles.
 * Server-renderable: it needs no JavaScript of its own — the countdown ticks
 * because it lives under the client ClockProvider.
 */
export function AuctionCard({
  auction,
  href,
  badge,
  meta,
  className,
  headingLevel: Heading = "h3",
  compact = false,
}: {
  auction: AuctionCardData;
  href?: string;
  /** Extra chip rendered over the image (e.g. "You're winning"). */
  badge?: React.ReactNode;
  /** Extra row under the price (e.g. your bid). */
  meta?: React.ReactNode;
  className?: string;
  /**
   * The card title's heading level, which depends on where the card sits.
   *
   * A card appears in two places with different outlines. On the home page it
   * lives under a `SectionHeading` (an `h2`), so the card title is correctly an
   * `h3`. In the Browse grid the only heading above it is the page `h1`, and an
   * `h3` there skipped a level — measured on /browse once real inventory
   * existed, where it was the only heading defect on the page.
   *
   * Hardcoding one level gets the other context wrong, so the caller states it.
   */
  headingLevel?: "h2" | "h3";
  compact?: boolean;
}) {
  const closed = isClosed(auction.status);
  // A paused auction keeps its endsAt in the future, but the clock is
  // stopped: showing a ticking countdown would contradict the Paused badge
  // on the same card, so the countdown hides exactly like a closed one.
  // The badge (LiveStatus above) already says Paused.
  const clockStopped = closed || auction.status === "PAUSED";
  const hasBids = auction.currentBidMinor !== null || auction.bidCount > 0;

  return (
    <Link
      href={href ?? `/listing/${auction.id}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[1.15rem] border bg-card shadow-[0_3px_12px_rgba(0,0,0,.04)] transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(.16,1,.3,1)]",
        "hover:-translate-y-[3px] hover:border-primary/40 hover:shadow-[0_20px_50px_-23px_rgba(0,0,0,.35)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className
      )}
      data-testid="auction-card"
      data-auction-id={auction.id}
      data-promoted={auction.featured ? "true" : undefined}
    >
      <div className={cn("relative overflow-hidden bg-muted", compact ? "aspect-square" : "aspect-[4/3]")}>
        <ImageWithFallback
          src={auction.imageUrl}
          alt={`${auction.title}, photo 1`}
          loading="lazy"
          responsive={{ width: 480, height: 360, sizes: "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" }}
          className="size-full object-cover transition-[transform,filter] duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.055]"
          fallback={
            <div className="grid size-full place-items-center bg-muted">
              <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden />
            </div>
          }
        />

        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/25 to-transparent" />

        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          {auction.isDirect ? (
            (!compact || auction.listingKind === "SERVICE") &&
            <span className="rounded-md bg-background/95 px-2 py-1 text-[11px] font-semibold">
              {auction.listingKind === "SERVICE" ? "Service" : "For sale"}
            </span>
          ) : <LiveStatus status={auction.status} endsAt={auction.endsAt} />}
          {auction.featured && (
            <span className="rounded-md border border-primary/20 bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground shadow-md shadow-primary/10">
              Promoted
            </span>
          )}
          {badge}
        </div>

        {auction.endsAt && !clockStopped && (
          <span className="absolute bottom-2 right-2 rounded-lg border border-border/70 bg-background/95 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
            <Countdown endsAt={auction.endsAt} status={auction.status} className="text-xs" />
          </span>
        )}
      </div>

      {compact ? (
        <div className="min-w-0 space-y-1 px-2.5 py-2.5 sm:px-3">
          <p data-testid="card-price" className="text-base font-bold leading-tight tracking-tight [overflow-wrap:anywhere]">
            {auction.listingKind === "SERVICE" ? "From " : !auction.isDirect ? (hasBids ? "Bid " : "Starts at ") : ""}
            <Money minor={auction.currentBidMinor ?? auction.startingBidMinor} compact={false} />
          </p>
          <Heading className="line-clamp-2 text-sm font-medium leading-snug [overflow-wrap:anywhere]">{auction.title}</Heading>
          {auction.location && <p className="truncate text-xs text-muted-foreground">{publicListingLocation(auction.location)}</p>}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <Heading className="line-clamp-2 text-[0.98rem] font-extrabold leading-snug tracking-[-.015em] transition-colors group-hover:text-primary">
              {auction.title}
            </Heading>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {auction.categoryName && (
              <span className="rounded-md bg-muted px-1.5 py-0.5">{auction.categoryName}</span>
            )}
            {auction.listingKind !== "SERVICE" && <ConditionBadge condition={auction.condition} className="px-1.5 py-0 text-[11px]" />}
            {auction.businessName && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/5 px-1.5 py-0.5 font-semibold text-primary">
                <Building2 className="size-3" aria-hidden />
                Business seller
              </span>
            )}
          </div>

          <div className="mt-auto flex items-end justify-between gap-2 pt-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {auction.listingKind === "SERVICE" ? "Starting from" : auction.isDirect ? "Asking price" : hasBids ? "Current bid" : "Starting bid"}
              </p>
              <p
                data-testid="card-price"
                className={cn(
                  "truncate text-lg font-bold tracking-tight",
                  auction.isDirect || auction.bidCount > 0 ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <Money
                  minor={auction.currentBidMinor ?? auction.startingBidMinor}
                  compact={false}
                />
              </p>
            </div>

            {!auction.isDirect && <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <Gavel className="size-3" aria-hidden />
              <span data-numeric>{auction.bidCount}</span>
              <span>{auction.bidCount === 1 ? "bid" : "bids"}</span>
            </div>}
          </div>

          {meta && <div className="border-t pt-2 text-[11px]">{meta}</div>}

          <div className="mt-0.5 flex items-center justify-between gap-3 border-t pt-2.5 text-xs">
            {auction.location ? (
              <p className="flex min-w-0 items-center gap-1 text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{publicListingLocation(auction.location)}</span>
              </p>
            ) : (
              <span />
            )}
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary">
              {auction.listingKind === "SERVICE" ? "View service" : auction.isDirect ? "View item" : "View listing"}
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
            </span>
          </div>
        </div>
      )}
    </Link>
  );
}

export function AuctionGrid({
  items,
  empty,
  className,
  headingLevel = "h3",
  compact = false,
}: {
  items: AuctionCardData[];
  empty?: React.ReactNode;
  className?: string;
  /**
   * See `AuctionCard`'s `headingLevel`. The grid is used in two places: under the
   * page `h1` on /browse, where the cards must be `h2`, and under a
   * `SectionHeading` on a profile, where `h3` is right. Defaulted to `h3` so
   * the nested case is the default and the flat case is stated.
   */
  headingLevel?: "h2" | "h3";
  compact?: boolean;
}) {
  if (items.length === 0 && empty) return <>{empty}</>;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        compact && "grid-cols-2 gap-2.5 sm:gap-4",
        className
      )}
    >
      {items.map((a) => (
        <AuctionCard key={a.id} auction={a} headingLevel={headingLevel} compact={compact} />
      ))}
    </div>
  );
}
