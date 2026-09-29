"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBannedAction, takedownAuctionAction } from "@/components/dashboard/admin-actions";
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
 * The two enforcement controls. Both follow the same shape because both need
 * the same thing from an operator: a deliberate confirmation that names the
 * target, the action, the reason and the consequence - and, after the call, the
 * actual database state rather than an optimistic guess.
 *
 * The reason is required up front, not optional, because an enforcement action
 * without a recorded reason is exactly the unauditable behavior the
 * moderation_events table exists to prevent. The database enforces the same
 * minimum independently.
 */

function useEnforcement() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  // The reason travels as an argument, not a closed-over binding: the action
  // runs after user input, and reading it from state at call time keeps one
  // obvious data flow instead of two that can disagree.
  function confirm(action: (reason: string) => Promise<void>) {
    const trimmed = reason.trim();
    setError(null);
    if (trimmed.length < 5) {
      setError("Give a reason of at least 5 characters. It goes into the audit record.");
      return;
    }
    startTransition(async () => {
      try {
        await action(trimmed);
        setOpen(false);
        setReason("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That action was refused. Reload and try again.");
      }
    });
  }

  return { pending, error, open, setOpen, reason, setReason, confirm, setError };
}

function ReasonField({
  reason,
  setReason,
  pending,
  id,
}: {
  reason: string;
  setReason: (v: string) => void;
  pending: boolean;
  id: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Reason (goes into the audit record)</Label>
      <Textarea
        id={id}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        disabled={pending}
        placeholder="What rule did this break, in concrete terms?"
      />
    </div>
  );
}

export function TakedownButton({
  auctionId,
  auctionTitle,
  reportId,
}: {
  auctionId: string;
  auctionTitle: string;
  reportId?: string;
}) {
  const [done, setDone] = useState(false);
  const e = useEnforcement();
  async function confirmTakedown() {
    await e.confirm(async (reason) => {
      const result = await takedownAuctionAction({ auctionId, reason, reportId });
      if (!result.ok) throw new Error(result.message);
      setDone(true);
    });
  }

  if (done) {
    return (
      <p role="status" className="text-xs font-medium text-foreground">
        Listing taken down and recorded. The seller has been notified.
      </p>
    );
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={e.pending}
        onClick={() => {
          e.setError(null);
          e.setOpen(true);
        }}
      >
        Take down listing
      </Button>
      <Dialog open={e.open} onOpenChange={e.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take down this listing?</DialogTitle>
            <DialogDescription>
              “{auctionTitle}” will be cancelled immediately. Buyers will not
              be able to bid, no payment flow can start, and the seller is
              notified that BidBlitz removed it. Bids placed so far stay in the
              history. This is recorded with your account as the actor and
              cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <ReasonField reason={e.reason} setReason={e.setReason} pending={e.pending} id={`takedown-reason-${auctionId}`} />
          {e.error && (
            <p role="alert" className="text-xs text-destructive">
              {e.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={e.pending} onClick={() => e.setOpen(false)}>
              Keep listing
            </Button>
            <Button type="button" variant="destructive" disabled={e.pending} onClick={confirmTakedown}>
              {e.pending ? "Taking down…" : "Take down listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function BanButton({
  userId,
  username,
  banned,
  reportId,
}: {
  userId: string;
  username: string;
  banned: boolean;
  reportId?: string;
}) {
  const [done, setDone] = useState<string | null>(null);
  const e = useEnforcement();
  async function confirmBan() {
    await e.confirm(async (reason) => {
      const result = await setBannedAction({ userId, banned: !banned, reason, reportId });
      if (!result.ok) throw new Error(result.message);
      setDone(!banned ? "suspended" : "restored");
    });
  }

  if (done) {
    return (
      <p role="status" className="text-xs font-medium text-foreground">
        @{username} {done}, and the action is recorded.
      </p>
    );
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant={banned ? "outline" : "destructive"}
        disabled={e.pending}
        onClick={() => {
          e.setError(null);
          e.setOpen(true);
        }}
      >
        {banned ? "Restore account" : "Suspend account"}
      </Button>
      <Dialog open={e.open} onOpenChange={e.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {banned ? `Restore @${username}?` : `Suspend @${username}?`}
            </DialogTitle>
            <DialogDescription>
              {banned ? (
                <>
                  @{username} will be able to bid and list again. The
                  restoration is recorded with your account as the actor.
                </>
              ) : (
                <>
                  @{username} will immediately lose the ability to bid, publish
                  or create listings, at the database boundary - not just in
                  the UI. Their existing live listings stay up until taken down
                  individually. This is recorded with your account as the actor.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <ReasonField reason={e.reason} setReason={e.setReason} pending={e.pending} id={`ban-reason-${userId}`} />
          {e.error && (
            <p role="alert" className="text-xs text-destructive">
              {e.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={e.pending} onClick={() => e.setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={banned ? "outline" : "destructive"}
              disabled={e.pending}
              onClick={confirmBan}
            >
              {e.pending ? "Working…" : banned ? "Restore account" : "Suspend account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
