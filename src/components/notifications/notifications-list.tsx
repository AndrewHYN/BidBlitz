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
): { headline: string; detail: React.ReactNode } {
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
            <Money minor={amountOf(p.current_bid_minor)} currency={currency} /> — the next minimum is{" "}
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
            The auction is complete — your review keeps this marketplace honest
            for the next buyer.
          </>
        ),
      };
    default:
      return { headline, detail: null };
  }
}

export function NotificationsList({ items }: { items: NotificationItem[] }) {
  return (
    <ul data-testid="notifications-list" className="space-y-3">
      {items.map((item) => {
        const unread = item.read_at === null;
        const { headline, detail } = describe(item.type, item.payload);
        // WON/SOLD/REVIEW_REQUEST carry the reader to the transaction itself:
        // payment state, fee breakdown and the review dialog all live there.
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
              {transactionLinked ? (
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
