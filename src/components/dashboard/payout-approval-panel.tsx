"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { requestPayoutApprovalAction, reviewPayoutApprovalAction } from "@/server/actions/payout-approval";

export type PayoutApproval = {
  id: string;
  requested_by: string;
  reviewed_by: string | null;
  status: "REQUESTED" | "APPROVED" | "VOIDED";
  requested_at: string;
  reviewed_at: string | null;
};

export function PayoutApprovalPanel({
  payoutId,
  approval,
  viewerId,
  canRequest,
  canReview,
}: {
  payoutId: string;
  approval: PayoutApproval | null;
  viewerId: string;
  canRequest: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"request" | "approve" | "reject" | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const active = approval?.status === "REQUESTED" || approval?.status === "APPROVED";
  const awaitingSecond = approval?.status === "REQUESTED" && approval.requested_by !== viewerId;
  const mayRequest = canRequest && !active;
  const mayReview = canReview && awaitingSecond;

  function submit() {
    if (!mode || pending || reason.trim().length < 15) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = mode === "request"
          ? await requestPayoutApprovalAction({ payoutId, reason: reason.trim() })
          : await reviewPayoutApprovalAction({
              requestId: approval!.id, approve: mode === "approve", note: reason.trim(),
            });
        if (!result.ok) {
          setDone(false);
          setMessage(result.message);
          return;
        }
        setDone(true);
        setMessage(mode === "request"
          ? "Request recorded. A different authorized staff member must approve it."
          : result.status === "APPROVED"
            ? "Second reviewer approved. This authorizes the review gate only, not a transfer."
            : "Approval rejected. A new request is required before money can move.");
        setReason("");
        setMode(null);
        router.refresh();
      } catch {
        setDone(false);
        setMessage("The request outcome is not confirmed. Reload before trying again.");
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4" data-testid="payout-second-approval">
      <h4 className="flex items-center gap-2 text-sm font-extrabold">
        <Users className="size-4 text-amber-600" aria-hidden /> Two-person approval required
      </h4>
      <p className="text-xs leading-5 text-muted-foreground">
        Payouts of $100 or more require approval from a second, different authorized employee.
        The database prevents payment instruction or marking the payout paid until this gate is satisfied.
      </p>
      <p className="flex items-center gap-2 text-xs font-bold">
        {approval?.status === "APPROVED" ? (
          <><ShieldCheck className="size-4 text-emerald-600" aria-hidden /> Independently approved</>
        ) : approval?.status === "REQUESTED" ? (
          <><ShieldAlert className="size-4 text-amber-600" aria-hidden />
          {approval.requested_by === viewerId ? "Waiting for another employee" : "Awaiting independent approval"}</>
        ) : "No active approval request"}
      </p>
      {approval?.status === "APPROVED" && <p className="text-xs text-muted-foreground">
        Approval does not prove seller receipt or make provider settlement automatic.
      </p>}
      {approval?.status === "REQUESTED" && approval.requested_by === viewerId && (
        <p className="text-xs text-muted-foreground">You requested this payout, so you cannot review it yourself.</p>
      )}
      {!mode && (
        <div className="flex flex-wrap gap-2">
          {mayRequest && <Button size="sm" type="button" variant="outline" onClick={() => { setMode("request"); setMessage(null); }}>Request second approval</Button>}
          {mayReview && <Button size="sm" type="button" onClick={() => { setMode("approve"); setMessage(null); }}>Review and approve</Button>}
          {mayReview && <Button size="sm" type="button" variant="outline" onClick={() => { setMode("reject"); setMessage(null); }}>Reject approval</Button>}
        </div>
      )}
      {mode && (
        <div className="space-y-3">
          <label className="text-xs font-bold" htmlFor={`approval-reason-${payoutId}`}>
            {mode === "request" ? "Reason for requesting payout" : "Independent review and evidence note"}
          </label>
          <Textarea id={`approval-reason-${payoutId}`} value={reason} rows={3}
            maxLength={1000} disabled={pending} onChange={(event) => setReason(event.target.value)}
            placeholder="Describe the verified handover, payment and reason for this decision (at least 15 characters)." />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || reason.trim().length < 15} onClick={submit}>
              {pending ? "Saving…" : mode === "request" ? "Submit request" : mode === "approve" ? "Confirm independent approval" : "Confirm rejection"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setMode(null); setReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}
      {message && <p role={done ? "status" : "alert"} className={done ? "text-xs font-semibold text-foreground" : "text-xs text-destructive"}>{message}</p>}
    </section>
  );
}
