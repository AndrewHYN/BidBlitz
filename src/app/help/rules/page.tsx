import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Coins, FileCheck, Lock, Scale, Timer, Undo2 } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/auction/page-header";

export const metadata: Metadata = {
  title: "Bidding rules",
  description:
    "How bidding works on BidBlitz: final bids, server-authoritative state, anti-sniping and idempotency.",
};

const RULES = [
  {
    icon: Lock,
    title: "Bids are final and binding",
    body: "Placing a bid is a commitment to buy at that price if you win. There are no retracts — bid only what you're willing to pay.",
  },
  {
    icon: Scale,
    title: "The server is authoritative",
    body: "Price, winner and end time are decided by the server, not your browser. The countdown on your screen is decoration; the database clock is the referee.",
  },
  {
    icon: Coins,
    title: "Every bid must beat the current price",
    body: "A bid has to be at least the current bid plus the auction's bid increment. The first bid must meet the starting price. Anything lower is rejected with the exact minimum you need.",
  },
  {
    icon: Timer,
    title: "Anti-sniping protects the ending",
    body: "A bid placed inside the final anti-snipe window extends the auction by the auction's anti-snipe extension — applied server-side, inside the same lock that records your bid, so the end time can never race the price.",
  },
  {
    icon: Undo2,
    title: "Duplicate submissions are idempotent",
    body: "Double-tap, retry or flaky network: the same submission is recognised by its request id and returns the original result. It never becomes a second bid.",
  },
  {
    icon: FileCheck,
    title: "Sellers can't bid on their own auctions",
    body: "The seller of an auction is blocked from bidding on it, so nobody can shill their own price up.",
  },
  {
    icon: Lock,
    title: "Terms are frozen after publishing",
    body: "Once an auction is published, its terms — price, increment, duration, description — can't be edited. What bidders saw is what they get.",
  },
] as const;

export default function HelpRulesPage() {
  return (
    <div data-testid="help-rules-page" className="page-container py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl space-y-10">
        <PageHeader
          title="Bidding rules"
          description="The rules the auction engine actually enforces — in Postgres, on every bid."
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
