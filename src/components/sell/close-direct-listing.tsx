"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/sell/confirm-dialog";
import { Button } from "@/components/ui/button";
import { closeDirectListingAction } from "@/server/actions/auction";

export function CloseDirectListing({ auctionId }: { auctionId: string }) {
  const [decision, setDecision] = useState<"sold" | "withdraw" | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function close() {
    if (!decision) return;
    startTransition(async () => {
      try {
        const result = await closeDirectListingAction({ auctionId, sold: decision === "sold" });
        if (!result.ok) {
          toast.error(result.rejection.message);
          return;
        }
        toast.success(decision === "sold" ? "Listing marked as sold" : "Listing removed");
        setDecision(null);
        router.refresh();
      } catch {
        toast.error("We couldn’t update this listing. Please try again.");
      }
    });
  }

  return (
    <section aria-label="Manage availability" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Manage availability</h2>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setDecision("sold")}>Mark as sold</Button>
        <Button type="button" variant="outline" onClick={() => setDecision("withdraw")}>Remove listing</Button>
      </div>
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => { if (!open) setDecision(null); }}
        title={decision === "sold" ? "Mark this item as sold?" : "Remove this listing?"}
        description="Buyers will stop seeing the item in listings and your contact number will be hidden."
        confirmLabel={decision === "sold" ? "Mark as sold" : "Remove listing"}
        pending={pending}
        error={null}
        cancelLabel="Go back"
        onConfirm={close}
      />
    </section>
  );
}
