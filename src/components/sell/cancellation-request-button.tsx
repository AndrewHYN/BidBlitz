"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestCancellationAction,
  withdrawCancellationAction,
  withdrawReviewAction,
} from "@/server/actions/auction";
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
 * Ask the team to end a live auction that has bids. There is no direct cancel
 * here on purpose: bidders hold commitments, so ending one is a decision with
 * two sides, not a button.
 *
 * What the seller is told, plainly and before submitting: the auction stays
 * live while the request waits, withdrawing is always allowed, and approval
 * ends it without a winner while rejection changes nothing.
 */
export function RequestCancellationButton({
  auctionId,
  title,
  bidCount,
}: {
  auctionId: string;
  title: string;
  bidCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<CancellationReason>("SELLER_WITHDRAWAL");
  const [explanation, setExplanation] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestCancellationAction({
          auctionId,
          reasonCode: reason,
          explanation: explanation.trim() || undefined,
        });
        if (!result.ok) {
          setError(renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor))));
          return;
        }
        setOpen(false);
        setSubmitted(true);
        router.refresh();
      } catch {
        setError("Something went wrong while sending the request. Please try again.");
      }
    });
  }

  if (submitted) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Cancellation requested. Your auction stays live while the BidBlitz team
        reviews it.
      </p>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-testid="request-cancellation-button"
      >
        Request cancellation
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Request auction cancellation?"
        description={`“${title}” has ${bidCount} bid${bidCount === 1 ? "" : "s"}, so it can't be silently cancelled. The BidBlitz team will review your request, and your auction stays live until they decide. Withdrawing the request is always allowed.`}
        confirmLabel="Submit request"
        cancelLabel="Keep it running"
        onConfirm={handleConfirm}
        pending={pending}
        error={error}
      >
        <div className="space-y-1.5 text-left">
          <Label htmlFor="cancel-request-reason">Reason</Label>
          <Select value={reason} onValueChange={(v) => setReason(v as CancellationReason)}>
            <SelectTrigger id="cancel-request-reason" data-testid="cancel-request-reason">
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
          <Label htmlFor="cancel-request-explanation">
            Explanation <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="cancel-request-explanation"
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="What changed, and anything the reviewer should know."
          />
        </div>
      </ConfirmDialog>
    </>
  );
}

/**
 * Take back a pending listing review to edit and resubmit. Withdrawing is
 * always safe: a pending review was never public, so there is nothing to
 * unwind, and the withdrawn row stays as history.
 */
export function WithdrawReviewButton({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        data-testid="withdraw-review-button"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await withdrawReviewAction({ auctionId });
              if (!result.ok) {
                setError(
                  renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor)))
                );
                return;
              }
              router.refresh();
            } catch {
              setError("We couldn't withdraw that review. Please try again.");
            }
          });
        }}
      >
        {pending ? "Withdrawing…" : "Withdraw to edit"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Take back a pending request. Withdrawing is the requester's own undo and
 * never touches the auction: the listing keeps running exactly as before.
 */
export function WithdrawCancellationButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await withdrawCancellationAction({ requestId });
              if (!result.ok) {
                setError(
                  renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor)))
                );
                return;
              }
              router.refresh();
            } catch {
              setError("We couldn't withdraw that request. Please try again.");
            }
          });
        }}
      >
        {pending ? "Withdrawing…" : "Withdraw request"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
