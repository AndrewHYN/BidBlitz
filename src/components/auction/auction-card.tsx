import Link from "next/link";
import { Gavel, MapPin, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuctionCardData } from "@/server/queries";
import { Money } from "@/components/auction/money";
import { Countdown } from "@/components/auction/countdown";
import { LiveStatus } from "@/components/auction/live-status";
import { isClosed } from "@/lib/auction-status";
import { ConditionBadge } from "@/components/auction/status-badge";

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
}: {
  auction: AuctionCardData;
  href?: string;
  /** Extra chip rendered over the image (e.g. "You're winning"). */
  badge?: React.ReactNode;
  /** Extra row under the price (e.g. your bid). */
  meta?: React.ReactNode;
  className?: string;
}) {
  const closed = isClosed(auction.status);
  const hasBids = auction.currentBidMinor !== null || auction.bidCount > 0;

  return (
    <Link
      href={href ?? `/auction/${auction.id}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className
      )}
      data-testid="auction-card"
      data-auction-id={auction.id}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {auction.imageUrl ? (
          // Supabase public bucket; plain img keeps remote-pattern config out of the build.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={auction.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center bg-gradient-to-br from-muted via-muted to-accent">
            <ImageIcon className="size-8 text-muted-foreground/60" aria-hidden />
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <LiveStatus status={auction.status} endsAt={auction.endsAt} />
          {auction.featured && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-sm">
              Featured
            </span>
          )}
          {badge}
        </div>

        {auction.endsAt && !closed && (
          <span className="absolute bottom-2 right-2 rounded-md bg-background/90 px-2 py-1 backdrop-blur-sm">
            <Countdown endsAt={auction.endsAt} status={auction.status} className="text-xs" />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-primary">
            {auction.title}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {auction.categoryName && (
            <span className="rounded bg-muted px-1.5 py-0.5">{auction.categoryName}</span>
          )}
          <ConditionBadge condition={auction.condition} className="px-1.5 py-0 text-[11px]" />
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {hasBids ? "Current bid" : "Starting bid"}
            </p>
            <p
              data-testid="card-price"
              className={cn(
                "truncate text-base font-semibold",
                auction.bidCount > 0 ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <Money
                minor={auction.currentBidMinor ?? auction.startingBidMinor}
                compact={false}
              />
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            <Gavel className="size-3" aria-hidden />
            <span data-numeric>{auction.bidCount}</span>
            <span>{auction.bidCount === 1 ? "bid" : "bids"}</span>
          </div>
        </div>

        {meta && <div className="border-t pt-2 text-[11px]">{meta}</div>}

        {auction.location && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="size-3" aria-hidden />
            <span className="truncate">{auction.location}</span>
          </p>
        )}
      </div>
    </Link>
  );
}

export function AuctionGrid({
  items,
  empty,
  className,
}: {
  items: AuctionCardData[];
  empty?: React.ReactNode;
  className?: string;
}) {
  if (items.length === 0 && empty) return <>{empty}</>;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
        className
      )}
    >
      {items.map((a) => (
        <AuctionCard key={a.id} auction={a} />
      ))}
    </div>
  );
}
