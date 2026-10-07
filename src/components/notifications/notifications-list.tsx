import Link from "next/link";
import type { Json } from "@/lib/supabase/types";
import { Money } from "@/components/auction/money";
import { MarkReadButton } from "@/components/notifications/mark-read-button";
import { isPaymentProviderConfigured } from "@/server/payments/config";

/**
 * The notification feed. Server-rendered: rows and their money copy are fixed
 * once per request, and only the per-row "Mark read" buttons ship as client
 * components.
 *
 * Copy is DERIVED from the engine's payload (never invented here) — amounts
 * go through `<Money>` so nothing is ever hand-formatted.
 */

export type NotificationItem = {
  id: string;
  type: string;
  payload: Json;
  read_at: string | null;
  created_at: string;
  auction_id: string | null;
};

/** Server-rendered once per request, so the row never re-formats. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function asRecord(payload: Json): Record<string, Json> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, Json>;
  }
  return {};
}

/** Minor units arrive as number or numeric string; hand both to `<Money>`. */
function amountOf(value: Json | undefined): bigint | number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

function describe(
  type: string,
  payload: Json
): { headline: string; detail: React.ReactNode; threadId?: string | null; href?: string | null; actionLabel?: string } {
  const p = asRecord(payload);
  const title = typeof p.title === "string" ? p.title : null;
  const currency = typeof p.currency === "string" ? p.currency : "USD";
  const headline = title ? `“${title}”` : type.replaceAll("_", " ").toLowerCase();

  switch (type) {
    case "NEW_BID":
      return {
        headline: `New bid on ${headline}`,
        detail: (
          <>
            The bid is now{" "}
            <Money minor={amountOf(p.current_bid_minor)} currency={currency} />.
            {typeof p.bid_count === "number" && (
              <> {p.bid_count} bid{p.bid_count === 1 ? "" : "s"} so far.</>
            )}
          </>
        ),
      };
    case "OUTBID":
      return {
        headline: `You’ve been outbid on ${headline}`,
        detail: (
          <>
            Your last bid was <Money minor={amountOf(p.your_last_bid_minor)} currency={currency} />. The new high is{" "}
            <Money minor={amountOf(p.current_bid_minor)} currency={currency} />. The next minimum is{" "}
            <Money minor={amountOf(p.next_min_minor)} currency={currency} />.
          </>
        ),
      };
    case "WON":
      return {
        headline: `You won ${headline}`,
        detail: (
          <>
            Winning bid{" "}
            <Money minor={amountOf(p.winning_bid_minor)} currency={currency} />.
          </>
        ),
      };
    case "SOLD":
      return {
        headline: `${headline} sold`,
        detail: (
          <>
            Winning bid{" "}
            <Money minor={amountOf(p.winning_bid_minor)} currency={currency} /> · Fee{" "}
            <Money minor={amountOf(p.fee_minor)} currency={currency} /> · You keep{" "}
            <Money minor={amountOf(p.net_minor)} currency={currency} />.
            {!isPaymentProviderConfigured() && (
              <>
                {" "}
                No payment provider is configured yet, so no money has moved.
              </>
            )}
          </>
        ),
      };
    case "ENDED_UNSOLD":
      return {
        headline: `${headline} ended with no bids`,
        detail: null,
      };
    case "BID_CONFIRMED":
      return {
        headline: `Bid placed on ${headline}`,
        detail: (
          <>
            <Money minor={amountOf(p.amount_minor)} currency={currency} />. Bids
            are final: if you win, you pay this amount plus the payment charge.
          </>
        ),
      };
    case "STAFF_REVIEW_REQUIRED":
      return {
        headline: `Review needed: ${headline}`,
        detail: <>This listing is held and cannot go public until staff decide.</>,
        href: "/admin#admin-review-heading",
        actionLabel: "Open review queue",
      };
    case "PROMOTION_REQUESTED":
      return {
        headline: `Promotion requested for ${headline}`,
        detail: <>A seller requested extra placement. Review it before activation.</>,
        href: "/admin#admin-promotions-heading",
        actionLabel: "Review promotion",
      };
    case "PROMOTION_APPROVED":
      return {
        headline: `${headline} is promoted`,
        detail:
          typeof p.featured_until === "string"
            ? <>Extra placement is active until {formatDate(p.featured_until)}.</>
            : <>Extra placement is active.</>,
      };
    case "PROMOTION_REJECTED":
      return {
        headline: `Promotion not activated for ${headline}`,
        detail: <>{typeof p.reason === "string" && p.reason ? p.reason : "The promotion request was not approved."}</>,
      };
    case "DELIVERY_CONFIRMED":
      return {
        headline: `Handover confirmed for ${headline}`,
        detail: <>The buyer confirmed receipt. BidBlitz can now release the seller proceeds.</>,
        href:
          typeof p.transactionId === "string"
            ? `/dashboard/transactions/${p.transactionId}`
            : "/dashboard/transactions",
        actionLabel: "Open sale",
      };
    case "PAYOUT_SENT":
      return {
        headline: `Seller payout sent`,
        detail:
          typeof p.amountMinor === "number" && typeof p.currency === "string"
            ? <>Your seller proceeds were sent through Linkwa.</>
            : <>Your seller proceeds were sent through Linkwa.</>,
        href: "/dashboard/transactions",
        actionLabel: "View activity",
      };
    case "PAYOUT_SETUP_REQUIRED":
      return {
        headline: "Finish seller payout setup",
        detail: <>Your sale is ready for payout, but BidBlitz still needs a ready payout wallet.</>,
        href: "/settings/payouts",
        actionLabel: "Set up payouts",
      };
    case "PAYOUT_ATTENTION":
      return {
        headline: "Seller payout needs a reconciliation check",
        detail: <>BidBlitz will not retry this payout automatically until the provider record is checked.</>,
        href: "/dashboard/transactions",
        actionLabel: "View activity",
      };
    case "REVIEW_SUBMITTED":
      return {
        headline: `${headline} sent for review`,
        detail: <>The team checks first listings before they go public.</>,
      };
    case "REVIEW_APPROVED":
      return {
        headline: `${headline} approved`,
        detail: (
          <>
            Your listing is public.{" "}
            {typeof p.ends_at === "string" && (
              <>Bidding closes {formatDate(p.ends_at)}.</>
            )}
          </>
        ),
      };
    case "REVIEW_REJECTED":
      return {
        headline: `${headline} was not approved`,
        detail: (
          <>{typeof p.reason === "string" ? p.reason : "See the listing page for what to fix."}</>
        ),
      };
    case "REVIEW_CHANGES_REQUESTED":
      return {
        headline: `${headline} needs changes`,
        detail: (
          <>{typeof p.reason === "string" ? p.reason : "See the listing page for what to fix."}</>
        ),
      };
    case "CANCELLATION_REQUESTED":
      return {
        headline: `Cancellation requested for ${headline}`,
        detail: <>The team reviews it while the auction stays live.</>,
      };
    case "CANCELLATION_DECIDED":
      return p.approved === true
        ? {
            headline: `Cancellation approved for ${headline}`,
            detail: <>The auction is cancelled. No winner, no payment, history kept.</>,
          }
        : {
            headline: `Cancellation request declined for ${headline}`,
            detail: (
              <>{typeof p.reason === "string" ? p.reason : "The auction stays live."}</>
            ),
          };
    case "AUCTION_PAUSED":
      return {
        headline: `${headline} paused by BidBlitz`,
        detail: <>Bidding is disabled and the clock is stopped while the team reviews an issue.</>,
      };
    case "AUCTION_RESUMED":
      return {
        headline: `${headline} is running again`,
        detail: (
          <>
            Bidding is open and the clock continues where it stopped.
            {typeof p.ends_at === "string" && <> It now ends {formatDate(p.ends_at)}.</>}
          </>
        ),
      };
    case "AUCTION_CANCELLED":
      return {
        headline: `${headline} was cancelled`,
        detail: <>No winner, no payment. Your bids stay in the history.</>,
      };
    case "LISTING_REMOVED":
      // A takedown notice names the outcome and where to ask about it - never
      // who reported the listing and never the internal reason. Those live in
      // moderation_events, which ordinary users cannot read.
      return {
        headline: `${headline} was removed by BidBlitz`,
        detail: (
          <>
            The listing broke marketplace rules, so it is no longer public. If
            you think that is a mistake,{" "}
            <Link href="/help" className="font-medium text-foreground underline underline-offset-2">
              get in touch through the help page
            </Link>
            .
          </>
        ),
      };
    case "AUCTION_PUBLISHED":
      return {
        headline: `${headline} is live`,
        detail:
          typeof p.ends_at === "string" ? (
            <>Bidding closes {formatDate(p.ends_at)}.</>
          ) : null,
      };
    case "ENDING_SOON":
      return {
        headline: `${headline} is ending soon`,
        detail:
          typeof p.ends_at === "string" ? (
            <>Closes {formatDate(p.ends_at)}.</>
          ) : null,
      };
    case "REVIEW_REQUEST":
      return {
        headline: `Leave a review for ${headline}`,
        detail: (
          <>
            The auction is complete. Your review keeps this marketplace honest
            for the next buyer.
          </>
        ),
      };
    case "PAYMENT_EXPIRED": {
      const transactionId = typeof p.transactionId === "string" ? p.transactionId : null;
      return {
        headline: `Expired unpaid: ${headline}`,
        detail: (
          <>
            {p.isSeller === true
              ? "The winner never paid, so the sale is closed and nothing is owed. You can list the item again."
              : "The payment window lapsed with no payment, so the sale is closed. Nothing was charged."}
          </>
        ),
        threadId: transactionId,
      };
    }
    case "NEW_MESSAGE": {
      const transactionId = typeof p.transactionId === "string" ? p.transactionId : null;
      return {
        headline: `New message about ${headline}`,
        detail: <>Open the conversation to read it and reply.</>,
        threadId: transactionId,
      };
    }
    default:
      return { headline, detail: null };
  }
}

export function NotificationsList({ items }: { items: NotificationItem[] }) {
  return (
    <ul data-testid="notifications-list" className="space-y-3">
      {items.map((item) => {
        const unread = item.read_at === null;
        const { headline, detail, threadId, href, actionLabel } = describe(item.type, item.payload);
        // WON/SOLD/REVIEW_REQUEST carry the reader to the transaction itself:
        // payment state, fee breakdown and the review dialog all live there.
        // NEW_MESSAGE deep-links to the private thread.
        const transactionLinked =
          item.type === "WON" ||
          item.type === "SOLD" ||
          item.type === "REVIEW_REQUEST";

        return (
          <li
            key={item.id}
            data-testid="notification-row"
            data-unread={unread ? "true" : undefined}
            className={
              unread
                ? "flex flex-wrap items-start justify-between gap-3 rounded-xl border border-primary/30 bg-card p-4 shadow-sm"
                : "flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm"
            }
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {unread && (
                  <span
                    aria-label="Unread"
                    className="size-2 rounded-full bg-primary"
                  />
                )}
                <p className="text-sm font-medium">{headline}</p>
              </div>
              {detail && (
                <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(item.created_at)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {href ? (
                <Link
                  href={href}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  {actionLabel ?? "Open"}
                </Link>
              ) : threadId ? (
                <Link
                  href={`/dashboard/transactions/${threadId}`}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  Read message
                </Link>
              ) : transactionLinked ? (
                <Link
                  href="/dashboard/transactions"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  {item.type === "REVIEW_REQUEST" ? "Write a review" : "View transaction"}
                </Link>
              ) : (
                item.auction_id && (
                  <Link
                    href={`/auction/${item.auction_id}`}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
                  >
                    View auction
                  </Link>
                )
              )}
              {unread && <MarkReadButton id={item.id} label={headline} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
