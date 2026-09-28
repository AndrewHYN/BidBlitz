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
    icon: Lock,
    title: "Bids are final and binding",
    body: "Placing a bid is a commitment to buy at that price if you win. There are no retracts — bid only what you're willing to pay.",
  },
  {
    icon: Scale,
    title: "The servers have the final say",
    body: "Price, winner and end time are decided on BidBlitz's servers, not in your browser. The countdown on your screen is a visual guide — the official clock is the referee.",
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
    icon: Lock,
    title: "Deal terms are locked at publish",
    body: "Once an auction is published, its starting price, bid increment, duration and closing time are frozen — nobody, not even the seller, can quietly change them. Bids and the anti-snipe extension are the only things that can move the price or the clock.",
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
