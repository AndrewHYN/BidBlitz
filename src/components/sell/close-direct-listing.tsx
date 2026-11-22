"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/sell/confirm-dialog";
import { Button } from "@/components/ui/button";
import { closeDirectListingAction } from "@/server/actions/auction";

export function CloseDirectListing({ auctionId, kind }: { auctionId: string; kind: "SALE" | "SERVICE" }) {
  const [decision, setDecision] = useState<"sold" | "withdraw" | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function close() {
    if (!decision || (kind === "SERVICE" && decision === "sold")) return;
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
    <section aria-label="Manage availability" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="font-semibold">Manage availability</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
        {kind === "SALE" && <Button type="button" variant="outline" onClick={() => setDecision("sold")}><BadgeCheck aria-hidden /> Mark as sold</Button>}
        <Button type="button" variant="destructive" onClick={() => setDecision("withdraw")}><Trash2 aria-hidden /> Remove listing</Button>
      </div>
      <ConfirmDialog
        open={decision !== null}
        onOpenChange={(open) => { if (!open) setDecision(null); }}
        title={decision === "sold" ? "Mark this item as sold?" : kind === "SERVICE" ? "Remove this service listing?" : "Remove this listing?"}
        description={kind === "SERVICE"
          ? "Customers will no longer find this service in search, and your contact number will be hidden. Completed service requests remain in chat history."
          : "Buyers will stop seeing the item in listings and your contact number will be hidden."}
        confirmLabel={decision === "sold" ? "Mark as sold" : kind === "SERVICE" ? "Remove service" : "Remove listing"}
        pending={pending}
        error={null}
        cancelLabel="Go back"
        onConfirm={close}
      />
    </section>
  );
}
