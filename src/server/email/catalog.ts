import type { EmailContent } from "./layout";

/**
 * The email catalog: every transactional email BidBlitz can send, as data.
 *
 * Each entry knows its subject, body and action, whether it is CRITICAL, and
 * which preference gates it when it is not. "Supporting" an event means an
 * entry here plus an enqueue call at the code path that owns the event - the
 * renderer, sender, idempotency and preferences are shared, so a new event is
 * a catalog entry and a queueEmail call, never new infrastructure.
 *
 * Critical means the email goes out regardless of preferences: security,
 * money, wins, cancellations and moderation decisions. Getting one of those
 * wrong because a checkbox was cleared is not a preference, it is a failure.
 * Everything else defaults per notification_preferences and can be silenced.
 *
 * Amounts arrive as preformatted strings: money formatting lives in the one
 * Money component and its formatMoney helper, and email copy must never
 * hand-format.
 */

export type EmailPreferenceKey = "outbid" | "ending_soon" | "marketplace_activity";

export type EmailTemplate = {
  key: string;
  critical: boolean;
  preference?: EmailPreferenceKey;
  subject: (d: Record<string, string>) => string;
  content: (d: Record<string, string>, appUrl: string) => EmailContent;
};

const auctionLink = (appUrl: string, auctionId: string) => `${appUrl}/auction/${auctionId}`;
const txLink = (appUrl: string) => `${appUrl}/dashboard/transactions`;
const helpLink = (appUrl: string) => `${appUrl}/help`;

export const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  review_submitted: {
    key: "review_submitted",
    critical: true,
    subject: (d) => `Your listing is under review: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Your listing is under review: ${d.title}`,
      name: d.name,
      headline: "Your listing is under review",
      paragraphs: [
        `“${d.title}” needs a human check before it can go public. Most reviews finish quickly.`,
        "You will get another email the moment there is a decision.",
      ],
      cta: { label: "View your listing", href: auctionLink(appUrl, d.auctionId) },
    }),
  },
  review_approved: {
    key: "review_approved",
    critical: true,
    subject: (d) => `Approved: ${d.title} is public`,
    content: (d, appUrl) => ({
      subject: `Approved: ${d.title} is public`,
      name: d.name,
      headline: "Your listing was approved",
      paragraphs: [
        `“${d.title}” is now public${d.endsAt ? ` and bidding closes ${d.endsAt}` : ""}. Share it to get the first bids in.`,
      ],
      cta: { label: "View your listing", href: auctionLink(appUrl, d.auctionId) },
    }),
  },
  review_rejected: {
    key: "review_rejected",
    critical: true,
    subject: (d) => `Your listing was not approved: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Your listing was not approved: ${d.title}`,
      name: d.name,
      headline: "Your listing was not approved",
      paragraphs: [
        `“${d.title}” cannot reach buyers in its current form.`,
        d.reason ? `The reason: ${d.reason}` : "See your dashboard for what to fix.",
      ],
      cta: { label: "Open your dashboard", href: `${appUrl}/dashboard/selling` },
    }),
  },
  review_changes: {
    key: "review_changes",
    critical: true,
    subject: (d) => `Changes needed: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Changes needed: ${d.title}`,
      name: d.name,
      headline: "Your listing needs changes",
      paragraphs: [
        d.reason ? `What to fix: ${d.reason}` : "See your dashboard for what to fix.",
        "Withdraw the review, make the change, and publish again.",
      ],
      cta: { label: "Open your dashboard", href: `${appUrl}/dashboard/selling` },
    }),
  },
  cancellation_requested: {
    key: "cancellation_requested",
    critical: true,
    subject: (d) => `Cancellation requested: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Cancellation requested: ${d.title}`,
      name: null,
      headline: "A seller asked to end an auction",
      paragraphs: [
        `“${d.title}” has ${d.bidCount} bids and the seller asked to end it early. Reason given: ${d.reason}.`,
        "Review it in the admin console. The auction stays live until you decide.",
      ],
      cta: { label: "Open the admin console", href: `${appUrl}/admin` },
    }),
  },
  cancellation_decided: {
    key: "cancellation_decided",
    critical: true,
    subject: (d) =>
      d.approved === "true"
        ? `Cancellation approved: ${d.title}`
        : `Cancellation request declined: ${d.title}`,
    content: (d, appUrl) => ({
      subject:
        d.approved === "true"
          ? `Cancellation approved: ${d.title}`
          : `Cancellation request declined: ${d.title}`,
      name: d.name,
      headline:
        d.approved === "true" ? "Your auction was cancelled" : "Your auction stays live",
      paragraphs:
        d.approved === "true"
          ? [
              `“${d.title}” is cancelled. No winner, no payment, and the bids stay in the history.`,
            ]
          : [
              `Your request to end “${d.title}” was declined, so it stays live with its bids.`,
              d.reason ? `The reason: ${d.reason}` : "",
            ].filter(Boolean),
      cta: { label: "Open your dashboard", href: `${appUrl}/dashboard/selling` },
    }),
  },
  auction_paused: {
    key: "auction_paused",
    critical: true,
    subject: (d) => `Paused: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Paused: ${d.title}`,
      name: d.name,
      headline: d.isSeller === "true" ? "Your auction was paused" : "An auction you bid on was paused",
      paragraphs: [
        `“${d.title}” is on hold while the BidBlitz team reviews an issue. Bidding is disabled and the clock is stopped.`,
        "Existing bids stay recorded, and nothing about the sale has been decided.",
      ],
      cta: { label: "View the auction", href: auctionLink(appUrl, d.auctionId) },
    }),
  },
  auction_resumed: {
    key: "auction_resumed",
    critical: true,
    subject: (d) => `Running again: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Running again: ${d.title}`,
      name: d.name,
      headline: "The auction is running again",
      paragraphs: [
        `“${d.title}” is open for bidding, and the clock continues where it stopped${d.endsAt ? ` (now ends ${d.endsAt})` : ""}.`,
      ],
      cta: { label: "View the auction", href: auctionLink(appUrl, d.auctionId) },
    }),
  },
  auction_cancelled: {
    key: "auction_cancelled",
    critical: true,
    subject: (d) => `Cancelled: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Cancelled: ${d.title}`,
      name: d.name,
      headline: "An auction you bid on was cancelled",
      paragraphs: [
        `“${d.title}” was cancelled. No winner, no payment, and your bids stay in the history.`,
      ],
      cta: { label: "Browse live auctions", href: `${appUrl}/browse` },
    }),
  },
  listing_removed: {
    key: "listing_removed",
    critical: true,
    subject: (d) => `Your listing was removed: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Your listing was removed: ${d.title}`,
      name: d.name,
      headline: "Your listing was removed",
      paragraphs: [
        `“${d.title}” broke marketplace rules, so it is no longer public.`,
        "If you think that is a mistake, reply through the help page and a person will look again.",
      ],
      cta: { label: "Open the help page", href: helpLink(appUrl) },
    }),
  },
  account_suspended: {
    key: "account_suspended",
    critical: true,
    subject: () => "Your BidBlitz account was suspended",
    content: (d, appUrl) => ({
      subject: "Your BidBlitz account was suspended",
      name: d.name,
      headline: "Your account was suspended",
      paragraphs: [
        "You cannot bid or list right now.",
        d.reason ? `The reason recorded: ${d.reason}` : "",
        "If you think that is a mistake, reply through the help page.",
      ].filter(Boolean),
      cta: { label: "Open the help page", href: helpLink(appUrl) },
    }),
  },
  account_restored: {
    key: "account_restored",
    critical: true,
    subject: () => "Your BidBlitz account was restored",
    content: (d, appUrl) => ({
      subject: "Your BidBlitz account was restored",
      name: d.name,
      headline: "Your account is restored",
      paragraphs: ["You can bid and list again."],
      cta: { label: "Browse live auctions", href: `${appUrl}/browse` },
    }),
  },
  won: {
    key: "won",
    critical: true,
    subject: (d) => `You won: ${d.title} for ${d.amount}`,
    content: (d, appUrl) => ({
      subject: `You won: ${d.title} for ${d.amount}`,
      name: d.name,
      headline: "You won this auction",
      paragraphs: [
        `“${d.title}” is yours for ${d.amount}. Pay promptly so the seller can fulfil your order.`,
      ],
      cta: { label: "Pay now", href: txLink(appUrl) },
    }),
  },
  outbid: {
    key: "outbid",
    critical: false,
    preference: "outbid",
    subject: (d) => `Outbid on ${d.title}: now ${d.amount}`,
    content: (d, appUrl) => ({
      subject: `Outbid on ${d.title}: now ${d.amount}`,
      name: d.name,
      headline: "You have been outbid",
      paragraphs: [
        `“${d.title}” is now at ${d.amount}. Bid again before the clock runs out if you still want it.`,
      ],
      cta: { label: "View the auction", href: auctionLink(appUrl, d.auctionId) },
    }),
  },
  auction_unsold: {
    key: "auction_unsold",
    critical: true,
    subject: (d) => `Ended with no bids: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Ended with no bids: ${d.title}`,
      name: d.name,
      headline: "Your auction ended with no bids",
      paragraphs: [
        `“${d.title}” closed without a sale, so nothing was charged and nothing is owed.`,
        "You can list it again from your selling dashboard.",
      ],
      cta: { label: "Open your dashboard", href: `${appUrl}/dashboard/selling` },
    }),
  },
  payment_required: {
    key: "payment_required",
    critical: true,
    subject: (d) => `Payment needed: ${d.title} (${d.amount})`,
    content: (d, appUrl) => ({
      subject: `Payment needed: ${d.title} (${d.amount})`,
      name: d.name,
      headline: "Your win is waiting on payment",
      paragraphs: [
        `“${d.title}” is yours for ${d.amount}. Complete payment so the seller can fulfil your order.`,
      ],
      cta: { label: "Pay now", href: txLink(appUrl) },
    }),
  },
  payment_received: {
    key: "payment_received",
    critical: true,
    subject: (d) => `Payment confirmed: ${d.title}`,
    content: (d, appUrl) => ({
      subject: `Payment confirmed: ${d.title}`,
      name: d.name,
      headline: "Payment confirmed",
      paragraphs: [
        `Your payment of ${d.amount} for “${d.title}” arrived. The seller has been told to fulfil your order.`,
        "That is separate from when the seller is paid: proceeds move after fulfilment and the dispute window.",
      ],
      cta: { label: "View your transaction", href: txLink(appUrl) },
    }),
  },
  team_invite: {
    key: "team_invite",
    critical: true,
    subject: () => "You are invited to the BidBlitz team",
    content: (d, appUrl) => ({
      subject: "You are invited to the BidBlitz team",
      name: null,
      headline: "Join the BidBlitz team",
      paragraphs: [
        `You have been invited with the ${d.role} role. The link works once and expires in 72 hours.`,
        "If you were not expecting this, ignore it: nothing changes without your sign-in.",
      ],
      cta: { label: "Accept the invitation", href: `${appUrl}/admin/team/accept?token=${d.token}` },
    }),
  },
  new_message: {
    key: "new_message",
    // Critical, not preference-gated: this is how a buyer and seller finish
    // a sale they have already committed to. A silenced "you have a message"
    // is a stalled fulfilment, not a quieter inbox.
    critical: true,
    subject: (d) => `New message about ${d.title}`,
    content: (d, appUrl) => ({
      subject: `New message about ${d.title}`,
      name: d.name,
      headline: `New message about “${d.title}”`,
      paragraphs: [
        `${d.senderName} wrote to you about the sale. Sign in to read it and reply.`,
        "Keep personal details inside this thread: it is visible only to you and the other party.",
      ],
      cta: { label: "Read the message", href: `${appUrl}/dashboard/transactions/${d.transactionId}` },
    }),
  },
};

export function getTemplate(key: string): EmailTemplate | null {
  return EMAIL_TEMPLATES[key] ?? null;
}
