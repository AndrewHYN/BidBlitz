"use client";

import { useState } from "react";
import { BriefcaseBusiness, Gavel, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { PUBLIC_AUCTIONS_ENABLED } from "@/lib/launch-features";
import { DirectListingForm } from "@/components/sell/direct-listing-form";
import { SellForm } from "@/components/sell/sell-form";

type Kind = "SALE" | "SERVICE" | "AUCTION";

const options = [
  { kind: "SALE" as const, title: "Sell an item", summary: "Post a fixed price and negotiate with buyers.", icon: Tag },
  ...(PUBLIC_AUCTIONS_ENABLED ? [{ kind: "AUCTION" as const, title: "Start an auction", summary: "Set a timed bidding window and auction rules.", icon: Gavel }] : []),
  { kind: "SERVICE" as const, title: "Offer a service", summary: "Let clients hire you and leave verified reviews.", icon: BriefcaseBusiness },
];

export function ListingTypeChooser({ categories }: { categories: { id: number; name: string }[] }) {
  const [kind, setKind] = useState<Kind>("SALE");
  return (
    <div className="space-y-6">
      <div className={`grid gap-3 ${PUBLIC_AUCTIONS_ENABLED ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} role="group" aria-label="Choose listing type">
        {options.map(({ kind: option, title, summary, icon: Icon }) => (
          <button key={option} type="button" onClick={() => setKind(option)}
            aria-pressed={option === kind}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors hover:border-primary/50",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              kind === option ? "border-primary bg-primary/5 shadow-sm" : "bg-card"
            )}>
            <Icon className="mb-3 size-5 text-primary" aria-hidden />
            <span className="block font-semibold">{title}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{summary}</span>
          </button>
        ))}
      </div>
      {kind === "AUCTION" ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
            Auctions use timed bids and the existing auction ledger. Online checkout is paused, so publishing an auction may require additional payout setup.
          </p>
          <SellForm categories={categories} feeBps={null} providerName={null} paymentsEnabled={false} />
        </div>
      ) : (
        <DirectListingForm key={kind} categories={categories} listingKind={kind} />
      )}
    </div>
  );
}
