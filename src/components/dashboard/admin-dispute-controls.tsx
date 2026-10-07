"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Clock3, Scale, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DISPUTE_PAYOUT_LABELS,
  DISPUTE_RESOLUTION_LABELS,
  DISPUTE_STATUS_LABELS,
} from "@/lib/disputes";
import type {
  DisputePayoutResolution,
  DisputeResolution,
  DisputeStatus,
} from "@/lib/supabase/types";
import { updateDisputeAction } from "@/server/actions/disputes";
import { cn } from "@/lib/utils";

const ACTIVE_STATES: DisputeStatus[] = [
  "OPEN",
  "WAITING_FOR_BUYER",
  "WAITING_FOR_SELLER",
  "UNDER_REVIEW",
];

const RESOLUTIONS: DisputeResolution[] = [
  "AGREEMENT_REACHED",
  "SELLER_RESPONSIBLE",
  "BUYER_RESPONSIBLE",
  "INSUFFICIENT_EVIDENCE",
  "CLOSED_NO_ACTION",
  "OTHER",
];

const PAYOUT_ACTIONS: DisputePayoutResolution[] = ["RELEASE", "HOLD", "NONE"];

export function AdminDisputeControls({
  disputeId,
  currentStatus,
  payoutStatus,
  resolved,
}: {
  disputeId: string;
  currentStatus: DisputeStatus;
  payoutStatus: string | null;
  resolved: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [resolution, setResolution] =
    useState<DisputeResolution>("AGREEMENT_REACHED");
  const [payoutResolution, setPayoutResolution] =
    useState<DisputePayoutResolution>("RELEASE");
  const [note, setNote] = useState("");

  function move(status: DisputeStatus) {
    setMessage(null);
    startTransition(async () => {
      const result = await updateDisputeAction({ disputeId, status });
      setMessage(result.ok ? `Case moved to ${DISPUTE_STATUS_LABELS[status]}.` : result.message);
    });
  }

  function resolve() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateDisputeAction({
        disputeId,
        status: "RESOLVED",
        resolution,
        payoutResolution,
        resolutionNote: note,
      });
      setMessage(result.ok ? "Case resolved and the payout decision was recorded." : result.message);
    });
  }

  if (resolved) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
          Staff decision recorded
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          This case is locked. The final outcome and payout decision remain in the audit trail.
        </p>
      </div>
    );
  }

  const payoutMayMove =
    payoutStatus !== "PAYOUT_DUE" && payoutStatus !== "PAID_OUT";

  return (
    <div className="case-staff-console space-y-5 rounded-2xl border p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Scale className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-bold">Staff case controls</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Move the case while you collect facts, then record one final outcome.
            This panel cannot issue a refund.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Case state</Label>
        <div className="flex flex-wrap gap-2">
          {ACTIVE_STATES.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={currentStatus === status ? "default" : "outline"}
              disabled={pending || currentStatus === status}
              onClick={() => move(status)}
            >
              <Clock3 className="size-3.5" aria-hidden />
              {DISPUTE_STATUS_LABELS[status]}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-background/80 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          <p className="text-sm font-bold">Resolve case</p>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Outcome</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {RESOLUTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setResolution(value)}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition",
                    resolution === value
                      ? "border-primary bg-primary/5 ring-1 ring-primary/15"
                      : "hover:border-primary/25 hover:bg-accent/30"
                  )}
                >
                  <span className="font-semibold">{DISPUTE_RESOLUTION_LABELS[value]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Seller payout</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {PAYOUT_ACTIONS.map((value) => {
                const disabled = !payoutMayMove && value !== "NONE";
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPayoutResolution(value)}
                    className={cn(
                      "rounded-lg border p-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-45",
                      payoutResolution === value
                        ? "border-primary bg-primary/5 ring-1 ring-primary/15"
                        : "hover:border-primary/25 hover:bg-accent/30"
                    )}
                  >
                    <span className="font-semibold">{DISPUTE_PAYOUT_LABELS[value]}</span>
                  </button>
                );
              })}
            </div>
            {!payoutMayMove && (
              <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                This payout is already in a provider-sensitive state ({payoutStatus}). BidBlitz will not claim it was stopped. Record the case outcome with “No payout change” and reconcile money separately.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dispute-resolution-note">Resolution note</Label>
            <Textarea
              id="dispute-resolution-note"
              rows={5}
              maxLength={4000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Record the evidence considered, the decision, and what each party should do next."
              disabled={pending}
            />
            <p className="text-xs text-muted-foreground">
              The buyer and seller can see this final note.
            </p>
          </div>

          <Button
            type="button"
            size="lg"
            disabled={pending || note.trim().length < 5}
            onClick={resolve}
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {pending ? "Recording decision…" : "Resolve dispute"}
          </Button>
        </div>
      </div>

      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
