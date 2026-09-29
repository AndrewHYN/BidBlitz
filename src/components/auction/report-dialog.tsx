"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reportSchema } from "@/lib/validation";
import { reportAction } from "@/server/actions/social";

/**
 * Report an auction or a user to moderation. Validation mirrors the server
 * schema so the user gets instant feedback, but the server remains
 * authoritative. One component for both targets, because the two flows differ
 * only in what is named: the action, the audit and the queue treat them the
 * same until an operator decides otherwise.
 */
export function ReportDialog({
  auctionId,
  userId,
  username,
}: {
  auctionId?: string;
  userId?: string;
  username?: string;
}) {
  const targetType = auctionId ? ("auction" as const) : ("user" as const);
  const targetId = (auctionId ?? userId) as string;
  const targetName =
    targetType === "auction" ? "this auction" : `@${username ?? "this user"}`;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = reportSchema.safeParse({
      targetType,
      targetId,
      reason: reason.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Tell us what's wrong.");
      return;
    }

    setPending(true);
    try {
      const result = await reportAction(parsed.data);
      if (result.ok) {
        toast.success("Report received", {
          description:
            targetType === "auction"
              ? "The BidBlitz team will review this listing."
              : "The BidBlitz team will review this account.",
        });
        setReason("");
        setOpen(false);
      } else {
        setError(result.rejection.message);
      }
    } catch {
      setError("Couldn't send the report. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          data-testid="report-button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Flag aria-hidden />
          {targetType === "auction" ? "Report this auction" : `Report @${username ?? "user"}`}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {targetType === "auction" ? "Report this auction" : `Report @${username ?? "user"}`}
          </DialogTitle>
          <DialogDescription>
            Tell us what&apos;s wrong with {targetName}. Reports go to the
            BidBlitz team and are never shown to{" "}
            {targetType === "auction" ? "the seller" : "that account"}.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={submit}
          /* POST: a pre-hydration native GET would put the report text into the
             URL. See login-form.tsx for the full reasoning. */
          method="post"
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="report-reason">What&apos;s wrong?</Label>
            <Textarea
              id="report-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              required
              aria-invalid={error ? true : undefined}
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Submit report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
