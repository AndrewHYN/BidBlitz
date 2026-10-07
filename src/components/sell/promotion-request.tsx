"use client";

import { useState, useTransition } from "react";
import { Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestPromotionAction } from "@/server/actions/promotion";

export function PromotionRequest({
  auctionId,
  activeUntil,
  pendingDays,
}: {
  auctionId: string;
  activeUntil: string | null;
  pendingDays: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<3 | 7>(3);
  const [message, setMessage] = useState<string | null>(null);

  if (activeUntil && new Date(activeUntil).getTime() > Date.now()) {
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
          You requested {pendingDays} days of promoted placement. BidBlitz will notify you after review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
      <div>
        <div className="flex items-center gap-2">
          <Megaphone className="size-4 text-primary" aria-hidden />
          <p className="text-sm font-bold">Give this auction more visibility</p>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Request a promoted placement. During the pilot, promotions are reviewed manually before they are activated.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Promotion length">
        {[3, 7].map((days) => (
          <button
            key={days}
            type="button"
            disabled={pending}
            onClick={() => setSelected(days as 3 | 7)}
            className={
              selected === days
                ? "rounded-lg border border-primary bg-primary/10 px-3 py-3 text-left shadow-sm ring-1 ring-primary/20"
                : "rounded-lg border bg-background px-3 py-3 text-left transition hover:border-primary/30 hover:bg-accent"
            }
          >
            <span className="block text-sm font-bold">{days} days</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Promoted placement
            </span>
          </button>
        ))}
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await requestPromotionAction({ auctionId, days: selected });
            setMessage(
              result.ok
                ? "Promotion request sent. You will be notified after review."
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
        Promotion changes placement only. It never changes bids, closing time, auction rules or winner selection.
      </p>
    </div>
  );
}
