import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Coins, FileCheck, Lock, Scale, Timer, Undo2 } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";

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
    <div data-testid="help-rules-page" className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <PageHeader
          title="Bidding rules"
          description="The rules the auction engine enforces on every single bid."
        />

        <section className="space-y-4">
          <SectionHeading title="The rules" />
          <ul className="space-y-3">
            {RULES.map((rule) => (
              <li
                key={rule.title}
                className="flex gap-4 rounded-xl border bg-card p-4 sm:p-5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <rule.icon className="size-4" aria-hidden />
                </span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">{rule.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {rule.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-sm">
          <Link href="/help/fees" className="font-medium text-primary hover:underline">
            See how fees and settlement work{" "}
            <ArrowRight className="inline size-3.5" aria-hidden />
          </Link>
        </p>
      </div>
    </div>
  );
}
