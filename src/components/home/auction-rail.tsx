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
  browseHref = "/browse",
}: {
  title: string;
  description?: string;
  auctions: AuctionCardData[];
  testid: "home-ending-soon" | "home-live" | "home-recent";
  emptyTitle: string;
  emptyDescription?: string;
  browseHref?: string;
}) {
  return (
    <section data-testid={testid} aria-label={title} className="space-y-4">
      <SectionHeading
        title={title}
        action={
          <Link
            href={browseHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
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
            "Nothing to show in this rail right now — check back soon."
          }
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
