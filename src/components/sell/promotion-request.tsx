"use client";

import { useMemo, useState, useTransition } from "react";
import { Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, money } from "@/lib/money";
import { requestPromotionAction } from "@/server/actions/promotion";

type Offer = {
  days: 3 | 7;
  priceMinor: number;
  currency: string;
  enabled: boolean;
};

export function PromotionRequest({
  auctionId,
  activeUntil,
  pendingDays,
  pendingPriceMinor,
  pendingCurrency,
  offers,
}: {
  auctionId: string;
  activeUntil: string | null;
  pendingDays: number | null;
  pendingPriceMinor: number | null;
  pendingCurrency: string | null;
  offers: Offer[];
}) {
  const available = useMemo(() => offers.filter((offer) => offer.enabled), [offers]);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<3 | 7>(
    available[0]?.days ?? 3
  );
  const [message, setMessage] = useState<string | null>(null);

  if (activeUntil) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden />
          Promoted now
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Extra homepage placement is active until{" "}
          {new Date(activeUntil).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          .
        </p>
      </div>
    );
  }

  if (pendingDays) {
    return (
      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="size-4 text-primary" aria-hidden />
          Promotion request pending
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          You requested {pendingDays} days of promoted placement
          {pendingPriceMinor !== null && pendingCurrency
            ? ` for ${formatMoney(money(pendingPriceMinor, pendingCurrency))}`
            : ""}
          . BidBlitz will notify you after review.
        </p>
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        Promoted placement is temporarily unavailable.
      </div>
    );
  }

  return (
    <div className="promotion-surface interactive-surface space-y-4 rounded-xl border border-primary/15 p-5">
      <div>
        <div className="flex items-center gap-2">
          <Megaphone className="size-4 text-primary" aria-hidden />
          <p className="text-sm font-bold">Give this auction more visibility</p>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Request promoted placement at the quoted price below. Staff review the request before activation.
        </p>
      </div>

      <div
        className="grid gap-2 sm:grid-cols-2"
        role="group"
        aria-label="Promotion length"
      >
        {available.map((offer) => (
          <button
            key={offer.days}
            type="button"
            disabled={pending}
            onClick={() => setSelected(offer.days)}
            className={
              selected === offer.days
                ? "rounded-xl border border-primary bg-primary/10 px-3 py-3 text-left shadow-sm ring-1 ring-primary/20"
                : "rounded-xl border bg-background px-3 py-3 text-left transition hover:border-primary/30 hover:bg-accent"
            }
          >
            <span className="block text-sm font-bold">{offer.days} days</span>
            <span className="mt-1 block text-lg font-bold text-primary" data-numeric>
              {formatMoney(money(offer.priceMinor, offer.currency))}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Promoted placement
            </span>
          </button>
        ))}
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={pending || !available.some((offer) => offer.days === selected)}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await requestPromotionAction({ auctionId, days: selected });
            setMessage(
              result.ok
                ? "Promotion request sent with this quoted price. You will be notified after review."
                : result.message
            );
          });
        }}
      >
        <Megaphone className="size-4" aria-hidden />
        {pending ? "Sending request…" : "Request promotion"}
      </Button>

      {message && (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          {message}
        </p>
      )}
      <p className="text-[11px] leading-5 text-muted-foreground">
        Promotion changes placement only. It never changes bids, closing time, auction rules or winner selection. Payment for promotion is not automated in this pilot.
      </p>
    </div>
  );
}
