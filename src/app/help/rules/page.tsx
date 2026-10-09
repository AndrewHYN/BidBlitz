import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Coins, FileCheck, Lock, Scale, Timer, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/auction/page-header";
import { DocumentPage } from "@/components/document-page";

export const metadata: Metadata = {
  title: "Bidding rules",
  description:
    "How bidding works on BidBlitz: bids are final, the servers decide the outcome, and anti-snipe protection guards the ending.",
  alternates: { canonical: "/help/rules" },
};

const RULES = [
  {
    icon: Timer,
    title: "Max Bid lets the seller confirm an early sale",
    body: "A Max Bid is a real binding bid plus a request to buy early. Only the seller can accept, and only while it remains the current highest bid in a live auction. Acceptance stops the timer and creates a sale awaiting payment. A declined or ignored request remains a normal bid. The 5% fee, buyer payment, handover confirmation and dispute protections still apply.",
  },
  {
    icon: Lock,
    title: "Bids are final and binding",
    body: "Placing a bid is a commitment to buy at that price if you win. There are no retracts. Bid only what you're willing to pay.",
  },
  {
    icon: Scale,
    title: "The servers have the final say",
    body: "Price, winner and end time are decided on BidBlitz's servers, not in your browser. The countdown on your screen is a visual guide. The official clock is the referee.",
  },
  {
    icon: Coins,
    title: "Every bid must beat the current price",
    body: "A bid has to be at least the current bid plus the auction's bid increment. The first bid must meet the starting price. Anything lower is rejected with the exact minimum you need.",
  },
  {
    icon: Timer,
    title: "Anti-sniping protects the ending",
    body: "If a bid lands inside the protected final window, the auction is extended by its anti-snipe extension. The extra time is added at the same moment the bid is recorded, so the clock and the price can never disagree.",
  },
  {
    icon: Undo2,
    title: "Double-taps never double-bid",
    body: "Every bid submission carries its own reference, so a retry or a flaky connection returns the original result instead of placing a second bid.",
  },
  {
    icon: FileCheck,
    title: "Sellers can't bid on their own auctions",
    body: "The seller of an auction is blocked from bidding on it, so nobody can shill their own price up.",
  },
  {
    icon: Timer,
    title: "A paused auction stops, it does not end",
    body: "BidBlitz can freeze an auction while the team reviews an issue. Bidding is disabled and the clock is stopped; existing bids stay recorded. When it resumes, the remaining time continues exactly where it stopped.",
  },
  {
    icon: Lock,
    title: "Deal terms are locked at publish",
    body: "Once an auction is published, its starting price, bid increment, duration and closing time are frozen. Nobody, not even the seller, can quietly change them. Bids and the anti-snipe extension can move the price or clock. Seller acceptance of the current highest Max Bid ends the auction immediately.",
  },
] as const;

const MARKETPLACE_RULES = [
  {
    title: "List only what is really yours to sell",
    body: "Stolen goods, counterfeits and items you do not own may not be listed. Electronics must be genuine: model numbers, storage sizes and included accessories have to match the actual item.",
  },
  {
    title: "Describe the item honestly",
    body: "Photos must show the actual item, and the description must match its condition, flaws included. A listing that misleads buyers on purpose is fraud, not marketing, and it is taken down.",
  },
  {
    title: "Keep payment on BidBlitz",
    body: "Winning bids are paid through the sale's transaction. Asking a buyer to pay elsewhere, or offering to complete a sale off the site, ends the listing and can end the account.",
  },
  {
    title: "First listings are checked before they go public",
    body: "A seller's first listing, high-value items, and accounts with reports or past violations are reviewed by the BidBlitz team before buyers can see them. Rejected listings return to draft with the reason; fixing and resubmitting is always allowed.",
  },
  {
    title: "Ending an auction early follows the rules",
    body: "A seller can end an auction with no bids, giving a reason. A seller may accept the current highest Max Bid to create an early sale. Cancelling an auction after bids exist requires a reviewed cancellation request: it stays live until the team decides, approval ends it with no winner and no payment, and rejection changes nothing.",
  },
  {
    title: "Some things may never be listed",
    body: "Counterfeits, stolen goods, items you do not own, weapons, and anything illegal to sell in Zimbabwe may not be listed. Listings that break this rule are taken down and the account is suspended.",
  },
  {
    title: "Auction sales are final: no cooling-off return",
    body: "Bids are binding and a win is a sale. Zimbabwe's Consumer Protection Act excludes transactions conducted by auction from its cooling-off provision, so there is no automatic return window. Problems after a sale go through support and the dispute process, never through cancelling the auction itself.",
  },
  {
    title: "One account, yours alone",
    body: "Shill bidding, bidding on your own auctions through another account, and creating a new account to dodge a suspension all lead to the same place: every involved account is suspended.",
  },
  {
    title: "No abuse, no harassment",
    body: "Threats, hate, scams and harassment in listings, messages, reviews or reports are treated as seriously as a fraudulent listing.",
  },
  {
    title: "Reports are for real problems",
    body: "File a report when a listing or an account breaks one of these rules. Deliberately false reports are themselves abuse and are treated that way.",
  },
] as const;

export default function HelpRulesPage() {
  return (
    <div data-testid="help-rules-page">
      <DocumentPage>
        <PageHeader
          title="Bidding rules"
          description="The rules the auction engine enforces on every single bid."
        />

        {/*
          Seven rules, each previously a card with an icon in a tinted square.
          These are not seven features competing for attention — they are one
          list a bidder reads straight through, and framing each item made the
          page look like a spec sheet of components instead of rules you can
          follow. As rows they scan as a sequence, which is how they are meant
          to be read, and the icon becomes an index marker rather than a badge.
        */}
        <ol className="border-t border-border/70">
          {RULES.map((rule, i) => (
            <li
              key={rule.title}
              className="flex gap-4 border-b border-border/70 py-4 sm:gap-5"
            >
              <span
                className="mt-0.5 shrink-0 tabular-nums text-sm font-medium text-muted-foreground/60"
                aria-hidden
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 space-y-1">
                {/* An h2, not an h3: these seven rules are the top-level content
                    of the page, and the only heading above them is the page h1,
                    so h3 skipped a level. */}
                <h2 className="font-medium">{rule.title}</h2>
                <p className="text-[0.9375rem] leading-[1.7] text-muted-foreground text-pretty">
                  {rule.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {/*
          What the bidding rules do not cover: the listing itself. Each of
          these maps to something the site can actually do about it - a report
          reason a user can file, and a takedown or suspension an operator can
          record. A rule without an enforcement path is decoration, so there
          are only as many rules as there are actions.
        */}
        <h2 className="pt-2 font-medium">Marketplace rules</h2>
        <ol className="border-t border-border/70">
          {MARKETPLACE_RULES.map((rule, i) => (
            <li
              key={rule.title}
              className="flex gap-4 border-b border-border/70 py-4 sm:gap-5"
            >
              <span
                className="mt-0.5 shrink-0 tabular-nums text-sm font-medium text-muted-foreground/60"
                aria-hidden
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium">{rule.title}</h3>
                <p className="text-[0.9375rem] leading-[1.7] text-muted-foreground text-pretty">
                  {rule.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-sm">
          <Link href="/help/fees" className="font-medium text-primary hover:underline">
            See how fees and settlement work{" "}
            <ArrowRight className="inline size-3.5" aria-hidden />
          </Link>
        </p>
      </DocumentPage>
    </div>
  );
}
