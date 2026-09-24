"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelAuctionAction } from "@/server/actions/auction";
import { formatMoney, money } from "@/lib/money";
import { renderRejectionMessage } from "@/server/errors";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/sell/confirm-dialog";

/**
 * Cancelling is only offered while nobody has bid — the engine rejects it
 * otherwise — and it is always a two-step, because a cancel is irreversible.
 */
export function CancelAuctionButton({
  auctionId,
  title,
}: {
  auctionId: string;
  title: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelAuctionAction({ auctionId });
        if (!result.ok) {
          setError(renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor))));
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError("Something went wrong while cancelling. Please try again.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-testid="cancel-auction-button"
      >
        Cancel auction
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this auction?"
        description={`“${title}” will be taken off market and can’t be re-published. Anyone watching it will see it as cancelled.`}
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep it running"
        onConfirm={handleConfirm}
        pending={pending}
        error={error}
      />
    </>
  );
}
