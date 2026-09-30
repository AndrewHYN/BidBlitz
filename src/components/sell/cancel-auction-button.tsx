"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelAuctionAction } from "@/server/actions/auction";
import {
  CANCELLATION_REASONS,
  cancellationReasonLabel,
  type CancellationReason,
} from "@/lib/validation";
import { formatMoney, money } from "@/lib/money";
import { renderRejectionMessage } from "@/server/errors";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/sell/confirm-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Cancelling is only offered while nobody has bid — the engine rejects it
 * otherwise — and it is always a two-step, because a cancel is irreversible.
 *
 * Past DRAFT the engine requires a reason code, so the dialog asks for one:
 * a controlled list, never free text, so the audit row always carries a
 * meaning the operator can act on. With bids on the auction there is no
 * button at all — only a request path (see RequestCancellationButton).
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
  const [reason, setReason] = useState<CancellationReason>("SELLER_WITHDRAWAL");
  const [explanation, setExplanation] = useState("");

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelAuctionAction({
          auctionId,
          reasonCode: reason,
          explanation: explanation.trim() || undefined,
        });
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
        description={`“${title}” will be taken off market and can’t be re-published. Anyone watching it will see it as cancelled. Tell us why, briefly. The reason is recorded.`}
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep it running"
        onConfirm={handleConfirm}
        pending={pending}
        error={error}
      >
        <div className="space-y-1.5 text-left">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Select value={reason} onValueChange={(v) => setReason(v as CancellationReason)}>
            <SelectTrigger id="cancel-reason" data-testid="cancel-reason">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANCELLATION_REASONS.map((code) => (
                <SelectItem key={code} value={code}>
                  {cancellationReasonLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 text-left">
          <Label htmlFor="cancel-explanation">
            Explanation <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="cancel-explanation"
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Anything the record should say beyond the reason."
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
