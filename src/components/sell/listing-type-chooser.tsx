"use client";

import { useState } from "react";
import { BriefcaseBusiness, Gavel, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { PUBLIC_AUCTIONS_ENABLED } from "@/lib/launch-features";
import { DirectListingForm } from "@/components/sell/direct-listing-form";
import { SellForm } from "@/components/sell/sell-form";

type Kind = "SALE" | "SERVICE" | "AUCTION";

const options = [
  { kind: "SALE" as const, title: "Sell an item", summary: "Fixed price", icon: Tag },
  ...(PUBLIC_AUCTIONS_ENABLED
    ? [{ kind: "AUCTION" as const, title: "Start an auction", summary: "Timed bids", icon: Gavel }]
    : []),
  { kind: "SERVICE" as const, title: "Offer a service", summary: "Get hired", icon: BriefcaseBusiness },
];

export function ListingTypeChooser({ categories, defaultLocation }: {
  categories: { id: number; name: string; slug: string }[];
  defaultLocation: string;
}) {
  const [kind, setKind] = useState<Kind>("SALE");
  return (
    <div className="space-y-4 sm:space-y-5">
      <div role="group" aria-label="Choose listing type" className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What are you posting?</p>
        <div className={"grid gap-2.5 " + (PUBLIC_AUCTIONS_ENABLED ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
          {options.map(({ kind: option, title, summary, icon: Icon }) => (
            <button key={option} type="button" onClick={() => setKind(option)}
              aria-pressed={option === kind} data-testid={"listing-kind-" + option.toLowerCase()}
              className={cn(
                "flex min-h-20 min-w-0 items-center gap-2.5 rounded-xl border px-3 py-3 text-left shadow-xs transition-[border-color,box-shadow,background-color] hover:border-primary/60 hover:shadow-sm",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4",
                kind === option ? "border-primary/75 bg-primary/5 ring-1 ring-primary/20" : "border-border/80 bg-card"
              )}>
              <span className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg border",
                kind === option ? "border-primary/25 bg-primary/10 text-primary" : "border-border/80 bg-muted/50 text-muted-foreground"
              )}><Icon className="size-4" aria-hidden /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-5 text-foreground">{title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{summary}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {kind === "AUCTION" ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
            Auctions use timed bids and the existing auction ledger. Online checkout is paused, so publishing an auction may require additional payout setup.
          </p>
          <SellForm categories={categories} feeBps={null} providerName={null} paymentsEnabled={false} defaultLocation={defaultLocation} />
        </div>
      ) : (
        <DirectListingForm key={kind} categories={categories} listingKind={kind} defaultLocation={defaultLocation} />
      )}
    </div>
  );
}
