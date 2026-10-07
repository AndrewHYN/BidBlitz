"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
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
import { DISPUTE_REASON_OPTIONS } from "@/lib/disputes";
import type { DisputeReason } from "@/lib/supabase/types";
import { openDisputeAction } from "@/server/actions/disputes";
import { cn } from "@/lib/utils";

export function OpenDisputeDialog({
  transactionId,
  compact = false,
}: {
  transactionId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DisputeReason>("ITEM_NOT_RECEIVED");
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await openDisputeAction({
        transactionId,
        reason,
        summary,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast.success("Dispute opened", {
        description: "BidBlitz has frozen the unpaid seller payout where it is still safe to do so.",
      });
      setOpen(false);
      router.push(`/dashboard/disputes/${result.disputeId}`);
      router.refresh();
    } catch {
      setError("BidBlitz could not open the dispute. Please try again.");
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
          variant={compact ? "ghost" : "outline"}
          size="sm"
          className={cn(compact && "text-muted-foreground")}
        >
          <ShieldAlert className="size-4" aria-hidden />
          Open dispute
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Open a transaction dispute</DialogTitle>
          <DialogDescription>
            Use this when a paid sale has a real handover, item or money problem.
            Opening a case can freeze an unpaid seller payout while BidBlitz reviews it.
          </DialogDescription>
        </DialogHeader>

        <form method="post" onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label>What happened?</Label>
            <div className="grid gap-2">
              {DISPUTE_REASON_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReason(option.value)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    reason === option.value
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/15"
                      : "bg-background hover:border-primary/25 hover:bg-accent/40"
                  )}
                >
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispute-summary">Tell us what happened</Label>
            <Textarea
              id="dispute-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={5}
              maxLength={3000}
              placeholder="What was agreed, what happened instead, and what have you already tried with the other person?"
              required
              aria-invalid={error ? true : undefined}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Keep the facts here. You can upload image evidence after the case opens.
            </p>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
            BidBlitz records and moderates disputes. This workflow does not issue a refund.
            Any return or refund arrangement is handled between buyer and seller.
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Opening case…" : "Open dispute"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
