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

/** Report an auction to moderation. Validation mirrors the server schema so
 *  the user gets instant feedback, but the server remains authoritative. */
export function ReportDialog({ auctionId }: { auctionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = reportSchema.safeParse({
      targetType: "auction",
      targetId: auctionId,
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
          description: "Our moderation team will review this auction.",
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
          Report this auction
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this auction</DialogTitle>
          <DialogDescription>
            Tell us what&apos;s wrong. Reports are confidential and reviewed by
            a human.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
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
