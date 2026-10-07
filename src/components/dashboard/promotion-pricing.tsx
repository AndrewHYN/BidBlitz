"use client";

import { useState, useTransition } from "react";
import { DollarSign, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatMoney, money } from "@/lib/money";
import { updatePromotionPricingAction } from "@/server/actions/promotion";

type Offer = {
  days: 3 | 7;
  priceMinor: number;
  enabled: boolean;
};

function OfferEditor({ offer }: { offer: Offer }) {
  const [enabled, setEnabled] = useState(offer.enabled);
  const [price, setPrice] = useState(
    (offer.priceMinor / 100).toFixed(2)
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="rounded-xl border bg-background/75 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold">{offer.days}-day promotion</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Current quote: {formatMoney(money(offer.priceMinor, "USD"))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`promotion-enabled-${offer.days}`} className="text-xs">
            {enabled ? "Available" : "Disabled"}
          </Label>
          <Switch
            id={`promotion-enabled-${offer.days}`}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={pending}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <DollarSign
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            className="pl-9"
            aria-label={`${offer.days}-day promotion price in USD`}
            disabled={pending}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const result = await updatePromotionPricingAction({
                days: offer.days,
                price,
                enabled,
              });
              setMessage(result.ok ? "Pricing updated." : result.message);
            });
          }}
        >
          <Power className="size-4" aria-hidden />
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>

      {message && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

export function PromotionPricing({ offers }: { offers: Offer[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {offers.map((offer) => (
        <OfferEditor key={offer.days} offer={offer} />
      ))}
    </div>
  );
}
