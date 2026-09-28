import Link from "next/link";
import { ArrowRight, Gavel } from "lucide-react";

import type { AuctionCardData } from "@/server/queries";
import { AuctionCard } from "@/components/auction/auction-card";
import { EmptyState, SectionHeading } from "@/components/auction/page-header";

/**
 * One horizontal rail of auction cards (Ending soon / Live now / Recently
 * listed). Server-renderable: the cards link themselves and tick under the
 * shared clock — the rail adds only the heading and its "Browse all" escape.
 */
export function AuctionRail({
  title,
  description,
  auctions,
  testid,
  emptyTitle,
  emptyDescription,
  emptyAction,
  browseHref = "/browse",
}: {
  title: string;
  description?: string;
  auctions: AuctionCardData[];
  testid: "home-ending-soon" | "home-live" | "home-recent";
  emptyTitle: string;
  emptyDescription?: string;
  /** A real, working call to action. An empty state with no way forward is a dead end. */
  emptyAction?: React.ReactNode;
  browseHref?: string;
}) {
  return (
    <section data-testid={testid} aria-label={title} className="space-y-4">
      <SectionHeading
        title={title}
        action={
          <Link
            href={browseHref}
            // `min-h-6` because this is not an inline link in a sentence: it is a
            // standalone control in the rail header, so WCAG 2.5.8's 24px minimum
            // applies and it measured 20px.
            className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            Browse all
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      {description && (
        <p className="-mt-2 text-sm text-muted-foreground">{description}</p>
      )}

      {auctions.length === 0 ? (
        <EmptyState
          compact
          icon={Gavel}
          title={emptyTitle}
          description={
            emptyDescription ??
            "Nothing to show in this rail right now. Check back soon."
          }
          action={emptyAction}
        />
      ) : (
        <div className="flex snap-x gap-4 overflow-x-auto pb-2">
          {auctions.map((auction) => (
            <AuctionCard
              key={auction.id}
              auction={auction}
              className="w-60 shrink-0 snap-start sm:w-72 lg:w-80"
            />
          ))}
        </div>
      )}
    </section>
  );
}
