"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  decideCancellationAction,
  decideReviewAction,
  pauseAuctionAction,
  resumeAuctionAction,
} from "@/components/dashboard/admin-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * The operator's decision controls: cancellation requests, listing reviews,
 * and pause/resume. Every one of them confirms with the target named and a
 * reason where the database demands one, then refreshes from server state so
 * the queue shows what the database recorded rather than what the operator
 * hoped.
 *
 * Rejections and change-requests always need a reason: the seller is owed the
 * why, and the audit row is owed it too. The RPCs enforce the same minimum
 * independently, so a direct call cannot skip it either.
 */

function DecisionDialog({
  triggerLabel,
  triggerVariant = "default",
  title,
  consequence,
  reasonLabel,
  reasonRequired,
  reasonPlaceholder,
  confirmLabel,
  confirmVariant = "default",
  testId,
  onConfirm,
  onDone,
}: {
  triggerLabel: string;
  triggerVariant?: "default" | "destructive" | "outline" | "ghost";
  title: string;
  consequence: React.ReactNode;
  reasonLabel: string;
  reasonRequired: boolean;
  reasonPlaceholder?: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive" | "outline" | "ghost";
  testId?: string;
  onConfirm: (reason: string) => Promise<void>;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function submit() {
    const trimmed = reason.trim();
    if (reasonRequired && trimmed.length < 5) {
      setError(
        "Give a reason of at least 5 characters. The seller sees it, and so does the audit record."
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onConfirm(trimmed);
        setOpen(false);
        setReason("");
        onDone?.();
        router.refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "That decision was refused. Reload and try again."
        );
      }
    });
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant={triggerVariant}
        disabled={pending}
        data-testid={testId}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{consequence}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>
              {reasonLabel}{" "}
              {reasonRequired ? null : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              disabled={pending}
              placeholder={reasonPlaceholder}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant={confirmVariant} disabled={pending} onClick={submit}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function throwIfRefused(result: { ok: boolean; message?: string }): Promise<void> {
  if (!result.ok) throw new Error(result.message ?? "That decision was refused.");
}

export function CancellationDecide({ requestId }: { requestId: string }) {
  const [done, setDone] = useState<string | null>(null);
  if (done) {
    return (
      <p role="status" className="text-xs font-medium text-foreground">
        Request {done}. All parties have been notified.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DecisionDialog
        triggerLabel="Approve"
        triggerVariant="destructive"
        testId="approve-cancellation-button"
        title="Approve cancellation?"
        consequence="The auction becomes CANCELLED immediately: no winner, no transaction, bids kept as history, and every bidder is notified. The seller's request reason stays on the record."
        reasonLabel="Approval note"
        reasonRequired={false}
        confirmLabel="Approve cancellation"
        confirmVariant="destructive"
        onConfirm={async (reason) => {
          const result = await decideCancellationAction({ requestId, approve: true, reason });
          await throwIfRefused(result);
          setDone("approved");
        }}
      />
      <DecisionDialog
        triggerLabel="Reject"
        triggerVariant="outline"
        testId="reject-cancellation-button"
        title="Reject cancellation?"
        consequence="Nothing changes about the auction: it stays live with its bids, its clock and its history. The seller is told your reason, so write the one you would want to receive."
        reasonLabel="Rejection reason"
        reasonRequired
        confirmLabel="Reject request"
        confirmVariant="outline"
        onConfirm={async (reason) => {
          const result = await decideCancellationAction({ requestId, approve: false, reason });
          await throwIfRefused(result);
          setDone("rejected");
        }}
      />
    </div>
  );
}

export function ReviewDecide({ reviewId }: { reviewId: string }) {
  const [done, setDone] = useState<string | null>(null);
  if (done) {
    return (
      <p role="status" className="text-xs font-medium text-foreground">
        Review {done}. The seller has been notified.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DecisionDialog
        triggerLabel="Approve"
        triggerVariant="default"
        testId="approve-review-button"
        title="Approve this listing?"
        consequence="The listing publishes on its configured schedule, or goes live from approval. The seller is notified."
        reasonLabel="Approval note"
        reasonRequired={false}
        confirmLabel="Approve listing"
        confirmVariant="default"
        onConfirm={async (reason) => {
          const result = await decideReviewAction({ reviewId, decision: "APPROVED", reason });
          await throwIfRefused(result);
          setDone("approved");
        }}
      />
      <DecisionDialog
        triggerLabel="Request changes"
        triggerVariant="outline"
        testId="request-changes-button"
        title="Ask for changes?"
        consequence="The listing returns to draft with your note attached. The seller can fix it and publish again, which re-runs the checks."
        reasonLabel="What needs to change"
        reasonRequired
        confirmLabel="Send back for changes"
        confirmVariant="outline"
        onConfirm={async (reason) => {
          const result = await decideReviewAction({ reviewId, decision: "CHANGES_REQUESTED", reason });
          await throwIfRefused(result);
          setDone("sent back for changes");
        }}
      />
      <DecisionDialog
        triggerLabel="Reject"
        triggerVariant="ghost"
        testId="reject-review-button"
        title="Reject this listing?"
        consequence="The listing returns to draft and cannot reach buyers in this form. Say plainly what rule it breaks."
        reasonLabel="Rejection reason"
        reasonRequired
        confirmLabel="Reject listing"
        confirmVariant="destructive"
        onConfirm={async (reason) => {
          const result = await decideReviewAction({ reviewId, decision: "REJECTED", reason });
          await throwIfRefused(result);
          setDone("rejected");
        }}
      />
    </div>
  );
}

export function PauseResumeButtons({
  auctionId,
  auctionTitle,
  paused,
}: {
  auctionId: string;
  auctionTitle: string;
  paused: boolean;
}) {
  const [done, setDone] = useState<string | null>(null);
  if (done) {
    return (
      <p role="status" className="text-xs font-medium text-foreground">
        {done}
      </p>
    );
  }
  if (paused) {
    return (
      <DecisionDialog
        triggerLabel="Resume auction"
        triggerVariant="outline"
        testId="resume-auction-button"
        title="Resume this auction?"
        consequence={`Bidding reopens on “${auctionTitle}” and the clock continues where it stopped: the end moves forward by exactly the time it spent paused, so nobody gains or loses bidding time.`}
        reasonLabel="Resume note"
        reasonRequired={false}
        confirmLabel="Resume auction"
        confirmVariant="default"
        onConfirm={async (reason) => {
          const result = await resumeAuctionAction({ auctionId, reason });
          await throwIfRefused(result);
          setDone("Auction resumed. The clock continues from where it stopped.");
        }}
      />
    );
  }
  return (
    <DecisionDialog
      triggerLabel="Pause auction"
      triggerVariant="outline"
      testId="pause-auction-button"
      title="Pause this auction?"
      consequence={`Bidding on “${auctionTitle}” stops immediately and the countdown freezes. Existing bids stay recorded and no winner can be settled while the hold lasts. Only an admin can resume it. Say why: the reason goes into the audit record.`}
      reasonLabel="Pause reason"
      reasonRequired
      confirmLabel="Pause auction"
      confirmVariant="destructive"
      onConfirm={async (reason) => {
        const result = await pauseAuctionAction({ auctionId, reason });
        await throwIfRefused(result);
        setDone("Auction paused. Bidding is disabled until it is resumed.");
      }}
    />
  );
}
