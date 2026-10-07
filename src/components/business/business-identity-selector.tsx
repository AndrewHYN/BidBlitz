"use client";

import { useState, useTransition } from "react";
import { Building2, UserRound } from "lucide-react";
import { setAuctionBusinessIdentityAction } from "@/server/actions/business";
import { cn } from "@/lib/utils";

export function BusinessIdentitySelector({
  auctionId,
  business,
  initialBusinessId,
}: {
  auctionId: string;
  business: {
    id: string;
    displayName: string;
    slug: string;
  } | null;
  initialBusinessId: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialBusinessId);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function choose(next: string | null) {
    if (next === selected) return;
    setMessage(null);
    startTransition(async () => {
      const result = await setAuctionBusinessIdentityAction({
        auctionId,
        businessId: next,
      });
      if (result.ok) {
        setSelected(next);
        setMessage(
          next
            ? "This auction will show your business as the seller."
            : "This auction will show your personal seller profile."
        );
      } else {
        setMessage(result.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => choose(null)}
          className={cn(
            "rounded-xl border p-4 text-left transition",
            selected === null
              ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/15"
              : "bg-background hover:border-primary/25 hover:bg-accent/30"
          )}
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <UserRound className="size-4" aria-hidden />
            Sell as yourself
          </span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            Buyers see your normal BidBlitz seller profile.
          </span>
        </button>

        {business && (
          <button
            type="button"
            disabled={pending}
            onClick={() => choose(business.id)}
            className={cn(
              "rounded-xl border p-4 text-left transition",
              selected === business.id
                ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/15"
                : "bg-background hover:border-primary/25 hover:bg-accent/30"
            )}
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <Building2 className="size-4" aria-hidden />
              Sell as {business.displayName}
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Buyers see your business storefront identity. This is labelled “Business seller,” not “Verified.”
            </span>
          </button>
        )}
      </div>

      {!business && (
        <p className="text-xs leading-5 text-muted-foreground">
          Want a storefront identity? Create a Business Seller profile in Settings first.
        </p>
      )}

      {message && (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          {pending ? "Updating seller identity…" : message}
        </p>
      )}
    </div>
  );
}
