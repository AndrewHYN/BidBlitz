"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CalendarCheck, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/sell/confirm-dialog";
import { closeDirectListingAction } from "@/server/actions/auction";
import { setListingPickupAction } from "@/server/actions/marketplace-deals";

/** A pickup plan belongs to ONE buyer conversation, not every enquiry. */
export function ListingPickupControls({
  listingId, conversationId, isSeller, reservedConversationId, isListed, isSold,
}: {
  listingId: string;
  conversationId: string;
  isSeller: boolean;
  reservedConversationId: string | null;
  isListed: boolean;
  isSold: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmSale, setConfirmSale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reservedHere = reservedConversationId === conversationId;
  const reservedElsewhere = !!reservedConversationId && !reservedHere;

  function changePickup(pickup: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setListingPickupAction({
          listingId, conversationId: pickup ? conversationId : null,
        });
        if (!result.ok) setError(result.message);
        else router.refresh();
      } catch {
        setError("Could not update pickup. Please try again.");
      }
    });
  }

  function finishSale() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await closeDirectListingAction({ auctionId: listingId, sold: true });
        if (!result.ok) setError(result.rejection.message);
        else {
          setConfirmSale(false);
          router.refresh();
        }
      } catch {
        setError("Could not mark the listing sold. Try again.");
      }
    });
  }

  if (!isSold && !isListed) return null;
  if (!isSeller && !reservedHere && !isSold) return null;

  return (
    <section aria-label="Pickup status" className="shrink-0 border-b bg-card px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {isSold ? <BadgeCheck aria-hidden className="size-4 text-emerald-600" /> : <CalendarCheck aria-hidden className="size-4 text-blue-600" />}
            {isSold ? "Listing marked sold" : reservedHere ? "Pending pickup" : reservedElsewhere ? "Pickup arranged in another chat" : "Arrange a pickup"}
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            {isSold
              ? "The seller closed this listing. BidBlitz has not processed or verified any payment."
              : reservedHere
                ? "The seller has reserved this item while you arrange collection. Inspect it before paying directly."
                : reservedElsewhere
                  ? "This item is reserved with another interested buyer. You can release that plan from its conversation."
                  : "Reserve this item for this buyer while you arrange handover. You can undo this at any time."}
          </p>
        </div>
        {isSeller && isListed && (
          <div className="flex flex-wrap gap-2">
            {!reservedConversationId && (
              <Button size="sm" type="button" disabled={pending} onClick={() => changePickup(true)}>
                <CalendarCheck aria-hidden /> Pending pickup
              </Button>
            )}
            {reservedHere && (
              <>
                <Button size="sm" type="button" variant="outline" disabled={pending} onClick={() => changePickup(false)}>
                  <RotateCcw aria-hidden /> Release pickup
                </Button>
                <Button size="sm" type="button" disabled={pending} onClick={() => setConfirmSale(true)}>
                  <BadgeCheck aria-hidden /> Mark sold
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <ConfirmDialog
        open={confirmSale}
        onOpenChange={setConfirmSale}
        title="Mark this listing as sold?"
        description="This permanently closes the listing. Interested buyers will be told the item is no longer available, not that they purchased it. No money is collected through BidBlitz."
        confirmLabel="Yes, mark sold"
        cancelLabel="Not yet"
        pending={pending}
        error={error}
        onConfirm={finishSale}
      />
    </section>
  );
}
