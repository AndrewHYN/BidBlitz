import { Gavel } from "lucide-react";
import { EmptyState, SectionHeading } from "@/components/auction/page-header";
import { Money } from "@/components/auction/money";
import { cn } from "@/lib/utils";

type BidWithBidder = {
  id: string;
  amount_minor: number;
  currency: string;
  created_at: string;
  is_winning: boolean;
  bidder: { username: string; display_name: string } | null;
};

/** Fixed locale + timezone so server HTML and any client render agree. */
function formatBidTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

/**
 * Bids newest-first, exactly as the query returned them (capped server-side).
 * The currently winning row is marked; nothing here is derived client-side.
 */
export function BidHistory({
  bids,
  currency,
}: {
  bids: BidWithBidder[];
  currency: string;
}) {
  return (
    <section
      data-testid="bid-history"
      aria-label="Bid history"
      className="space-y-4"
    >
      <SectionHeading
        title="Bid history"
        action={
          <span className="text-sm text-muted-foreground">
            <span data-numeric>{bids.length}</span>{" "}
            {bids.length === 1 ? "bid" : "bids"} · newest first
          </span>
        }
      />

      {bids.length === 0 ? (
        <EmptyState
          compact
          icon={Gavel}
          title="No bids yet"
          description="Be the first to bid — every bid will be listed here the moment it's accepted."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {bids.map((bid) => (
            <li
              key={bid.id}
              data-testid="bid-row"
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3",
                bid.is_winning && "bg-won/5"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                {bid.is_winning && (
                  <span
                    data-testid="winning-badge"
                    className="shrink-0 rounded-full bg-won px-2 py-0.5 text-[11px] font-semibold text-won-foreground"
                  >
                    Winning
                  </span>
                )}
                <span className="truncate text-sm font-medium">
                  {bid.bidder?.display_name ||
                    bid.bidder?.username ||
                    "Anonymous bidder"}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <time
                  dateTime={bid.created_at}
                  className="text-xs text-muted-foreground"
                >
                  {formatBidTime(bid.created_at)}
                </time>
                <span className="text-sm font-semibold">
                  <Money
                    minor={bid.amount_minor}
                    currency={bid.currency || currency}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
