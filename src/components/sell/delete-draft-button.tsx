"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteDraftAction } from "@/server/actions/auction";
import { formatMoney, money } from "@/lib/money";
import { renderRejectionMessage } from "@/server/errors";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/sell/confirm-dialog";

/**
 * Only untouched drafts can be deleted (the database enforces the same rule),
 * and deleting one is permanent — hence the confirmation.
 */
export function DeleteDraftButton({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteDraftAction({ auctionId });
        if (!result.ok) {
          setError(renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor))));
          return;
        }
        router.push("/dashboard/selling");
      } catch {
        setError("Something went wrong while deleting. Please try again.");
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
        data-testid="delete-draft-button"
      >
        <Trash2 className="size-4" aria-hidden />
        Delete draft
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this draft?"
        description="The listing and its photos are removed for good. This can’t be undone."
        confirmLabel="Yes, delete it"
        cancelLabel="Keep the draft"
        onConfirm={handleConfirm}
        pending={pending}
        error={error}
      />
    </>
  );
}
