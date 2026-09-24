import Link from "next/link";
import { Star } from "lucide-react";
import { EmptyState } from "@/components/auction/page-header";
import { cn } from "@/lib/utils";

/**
 * Reviews as the server returned them, plus an auction link target the shared
 * query doesn't expose (see the profile page). Pure presentation.
 */

export type ProfileReview = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  /**
   * PostgREST embeds a to-one relation as an object but may deliver an array
   * depending on schema introspection — accept both, like `toCard` does.
   */
  reviewer:
    | { username: string; display_name: string }
    | Array<{ username: string; display_name: string }>
    | null;
  auctions: { title: string } | Array<{ title: string }> | null;
  auctionId: string | null;
};

function firstOf<T>(value: T | Array<T> | null): T | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span
      role="img"
      aria-label={`${rating} out of 5 stars`}
      className="flex items-center gap-0.5"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn(
            "size-4",
            i <= rating ? "fill-current text-primary" : "text-muted-foreground/40"
          )}
        />
      ))}
    </span>
  );
}

function reviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ReviewList({ reviews }: { reviews: ProfileReview[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={Star}
        title="No reviews yet"
        description="Reviews appear after completed sales."
        compact
      />
    );
  }

  return (
    <ul data-testid="review-list" className="space-y-3">
      {reviews.map((review) => {
        const reviewer = firstOf(review.reviewer);
        const auction = firstOf(review.auctions);

        return (
          <li
            key={review.id}
            data-testid="review-row"
            className="rounded-xl border bg-card p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Stars rating={review.rating} />
              <time
                dateTime={review.created_at}
                className="text-xs text-muted-foreground"
              >
                {reviewDate(review.created_at)}
              </time>
            </div>

            {review.comment && (
              <p className="mt-2 text-sm text-foreground text-balance">
                {review.comment}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {reviewer ? (
                reviewer.username ? (
                  <Link
                    href={`/profile/${reviewer.username}`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {reviewer.display_name}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">
                    {reviewer.display_name}
                  </span>
                )
              ) : (
                <span>Verified buyer</span>
              )}
              {auction?.title && (
                <>
                  <span aria-hidden>·</span>
                  {review.auctionId ? (
                    <Link
                      href={`/auction/${review.auctionId}`}
                      className="hover:text-primary hover:underline"
                    >
                      {auction.title}
                    </Link>
                  ) : (
                    <span>{auction.title}</span>
                  )}
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
