import { Bell, BriefcaseBusiness, Check, ChevronRight, ClipboardCheck, Gavel, MessageCircle, Tag } from "lucide-react";
import { ImageWithFallback } from "@/components/auction/image-with-fallback";
import { NotificationLink } from "./notification-link";
import type { Json } from "@/lib/supabase/types";
import { Money } from "@/components/auction/money";
import { MarkReadButton } from "@/components/notifications/mark-read-button";
import { isPaymentProviderConfigured } from "@/server/payments/config";

export type NotificationItem = {
  id: string;
  type: string;
  payload: Json;
  read_at: string | null;
  created_at: string;
  auction_id: string | null;
  listingKind: "SALE" | "SERVICE" | "AUCTION" | null;
  photo: string | null;
};

/** Server-rendered once per request, so the row never re-formats. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "Africa/Harare",
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
  payload: Json,
  kind: NotificationItem["listingKind"]
): { headline: string; detail: React.ReactNode; threadId?: string | null; href?: string | null; actionLabel?: string } {
  const p = asRecord(payload);
  const title = typeof p.title === "string" ? p.title : null;
  const currency = typeof p.currency === "string" ? p.currency : "USD";
  const headline = title ? `“${title}”` : type.replaceAll("_", " ").toLowerCase();

  switch (type) {
    case "NEW_BID":
      return {
        headline: `${p.max_bid === true ? "Max Bid purchase offer" : "New bid"} on ${headline}`,
        detail: (
          <>
            {p.max_bid === true && <>Review this offer to sell early. </>}
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
        headline: kind === "AUCTION" ? `${headline} ended with no bids` : `${headline} ended`,
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
        href: typeof p.review_id === "string" ? `/admin/listings#review-${encodeURIComponent(p.review_id)}` : "/admin/listings",
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
    case "DISPUTE_STAFF_REQUIRED":
      return {
        headline: `Dispute needs review: ${headline}`,
        detail: <>A buyer or seller opened a case on a paid transaction. Review the evidence and payout state.</>,
        href: "/admin/disputes",
        actionLabel: "Open dispute queue",
      };
    case "DISPUTE_OPENED":
      return {
        headline: `Dispute opened for ${headline}`,
        detail: <>The transaction now has a BidBlitz case. Unpaid seller proceeds may be frozen while staff review it.</>,
        href:
          typeof p.disputeId === "string"
            ? `/dashboard/disputes/${p.disputeId}`
            : "/dashboard/disputes",
        actionLabel: "Open case",
      };
    case "DISPUTE_MESSAGE":
      return {
        headline: `New dispute update: ${headline}`,
        detail: <>A new message was added to the transaction case.</>,
        href:
          typeof p.disputeId === "string"
            ? `/dashboard/disputes/${p.disputeId}`
            : "/dashboard/disputes",
        actionLabel: "Read case",
      };
    case "DISPUTE_STATUS_CHANGED":
      return {
        headline: `Dispute status changed: ${headline}`,
        detail:
          typeof p.status === "string"
            ? <>The case is now {p.status.replaceAll("_", " ").toLowerCase()}.</>
            : <>BidBlitz updated the case status.</>,
        href:
          typeof p.disputeId === "string"
            ? `/dashboard/disputes/${p.disputeId}`
            : "/dashboard/disputes",
        actionLabel: "Open case",
      };
    case "DISPUTE_RESOLVED":
      return {
        headline: `Dispute resolved: ${headline}`,
        detail: <>BidBlitz recorded the case outcome and seller-payout decision. This workflow does not issue refunds.</>,
        href:
          typeof p.disputeId === "string"
            ? `/dashboard/disputes/${p.disputeId}`
            : "/dashboard/disputes",
        actionLabel: "View decision",
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
            {kind === "AUCTION" && typeof p.ends_at === "string" && (
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
        detail: "This listing was removed under the marketplace rules.",
        href: "/help",
        actionLabel: "Get help",
      };
    case "AUCTION_PUBLISHED":
      return {
        headline: kind === "SALE" ? `${headline} is now for sale` : kind === "SERVICE" ? `${headline} is available to hire` : `${headline} is live`,
        detail:
          kind === "AUCTION" && typeof p.ends_at === "string" ? (
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
        href: typeof p.transaction_id === "string" ? `/dashboard/transactions#review-${encodeURIComponent(p.transaction_id)}` : "/dashboard/transactions",
        actionLabel: "Write a review",
        detail: (
          <>
            Share your experience with the other trader.
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
      const chatId = typeof p.listingChatId === "string" ? p.listingChatId : null;
      return {
        headline: `New message about ${headline}`,
        detail: null,
        href: chatId ? `/messages/${encodeURIComponent(chatId)}` : transactionId ? `/dashboard/transactions/${encodeURIComponent(transactionId)}#messages` : "/messages",
      };
    }
    default:
      return { headline, detail: null };
  }
}

const kinds = {
  SALE: { label: "Sale", Icon: Tag },
  SERVICE: { label: "Service", Icon: BriefcaseBusiness },
  AUCTION: { label: "Auction", Icon: Gavel },
};

export function NotificationsList({ items }: { items: NotificationItem[] }) {
  return (
    <ul data-testid="notifications-list" className="notification-feed">
      {items.map(item => {
        const unread = item.read_at === null;
        const { headline, detail, threadId, href, actionLabel } = describe(item.type, item.payload, item.listingKind);
        const p = asRecord(item.payload);
        const saleEvent = ["WON", "SOLD"].includes(item.type);
        const transactionId = threadId ?? p.transactionId ?? p.transaction_id;
        const saleUrl = typeof transactionId === "string" ? `/dashboard/transactions/${encodeURIComponent(transactionId)}` : "/dashboard/transactions";
        const destination = href ?? (saleEvent || threadId ? saleUrl : item.auction_id ? `/listing/${item.auction_id}` : null);
        const listing = item.listingKind ? kinds[item.listingKind] : { label: "Listing", Icon: Tag };
        const topic = item.type === "NEW_MESSAGE" ? { label: "Message", Icon: MessageCircle }
          : item.type === "STAFF_REVIEW_REQUIRED" ? { label: "Staff review", Icon: ClipboardCheck }
          : item.auction_id ? listing : { label: "Account", Icon: Bell };
        const { Icon } = topic;
        const content = (
          <>
            <span className="notification-photo" aria-hidden="true">
              <ImageWithFallback src={item.photo} alt="" loading="lazy" responsive={{ width: 72, height: 72 }} className="size-full object-cover"
                fallback={<Icon className="size-5 sm:size-6" />} />
            </span>
            <span className="min-w-0">
              <span className="notification-meta">
                <span>{topic.label}</span>
                <span className="notification-state">
                  {unread ? <i aria-hidden /> : <Check aria-hidden className="size-3" />}
                  {unread ? "Unread" : "Read"}
                </span>
              </span>
              <span className="notification-title">{headline}</span>
              {detail && <span className="notification-detail">{detail}</span>}
              <span className="notification-foot">
                <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
                {actionLabel && item.type !== "NEW_MESSAGE" && <span className="notification-action">{actionLabel}</span>}
              </span>
            </span>
            {destination && <ChevronRight aria-hidden className="notification-chevron" />}
          </>
        );
        return (
          <li key={item.id} data-testid="notification-row" data-unread={unread}>
            {destination ? <NotificationLink id={item.id} unread={unread} href={destination}>{content}</NotificationLink>
              : <><div className="notification-row-content">{content}</div>{unread && <MarkReadButton id={item.id} label={headline} />}</>}
          </li>
        );
      })}
    </ul>
  );
}
