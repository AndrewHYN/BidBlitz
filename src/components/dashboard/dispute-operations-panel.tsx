"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ClipboardList, LockKeyhole, MessageSquareText, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { assignDisputeAgentAction, addPrivateDisputeNoteAction } from "@/server/actions/dispute-operations";

type Operator = { id: string; name: string };
type Assignment = {
  assigned_to: string; priority: "NORMAL" | "HIGH" | "URGENT";
  next_action_at: string; updated_at: string;
};
type Activity = {
  id: string; actor_id: string; event_type: "ASSIGNED" | "REASSIGNED" | "INTERNAL_NOTE";
  description: string; created_at: string;
};

export function DisputeOperationsPanel({
  disputeId, status, operators, assignment, activity,
}: {
  disputeId: string;
  status: string;
  operators: Operator[];
  assignment: Assignment | null;
  activity: Activity[];
}) {
  const router = useRouter();
  const [assignee, setAssignee] = useState(assignment?.assigned_to ?? operators[0]?.id ?? "");
  const [priority, setPriority] = useState<"NORMAL" | "HIGH" | "URGENT">(assignment?.priority ?? "NORMAL");
  const [target, setTarget] = useState<24 | 48 | 72>(24);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const assignedName = operators.find((person) => person.id === assignment?.assigned_to)?.name ?? "Unassigned / former staff";
  const resolved = status === "RESOLVED";

  function submitAssignment() {
    if (pending || !assignee || resolved) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await assignDisputeAgentAction({
          disputeId, assigneeId: assignee, priority, targetHours: target,
        });
        setFeedback(result.ok
          ? { ok: true, message: "Assignment and next review target saved to the case audit trail." }
          : { ok: false, message: result.message });
        if (result.ok) router.refresh();
      } catch {
        setFeedback({ ok: false, message: "Assignment outcome is uncertain. Refresh before trying again." });
      }
    });
  }

  function submitNote() {
    if (pending || note.trim().length < 10) return;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await addPrivateDisputeNoteAction({ disputeId, note: note.trim() });
        setFeedback(result.ok
          ? { ok: true, message: "Private staff note recorded. Buyers and sellers cannot see it." }
          : { ok: false, message: result.message });
        if (result.ok) {
          setNote("");
          router.refresh();
        }
      } catch {
        setFeedback({ ok: false, message: "Note outcome could not be verified. Refresh before retrying." });
      }
    });
  }

  return (
    <section className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm sm:p-7" data-testid="dispute-operations-panel">
      <header>
        <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.16em] text-orange-600 dark:text-orange-400">
          <LockKeyhole className="size-4" aria-hidden /> Internal BidBlitz only
        </p>
        <h2 className="mt-2 text-2xl font-black tracking-tight">Case ownership & staff notes</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Assign an authorized agent, set a review target, and record sensitive investigation notes.
          These notes are never inserted into the public buyer/seller conversation.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
          <h3 className="flex items-center gap-2 text-sm font-black"><ClipboardList className="size-4" aria-hidden /> Assignment</h3>
          {assignment && (
            <div className="space-y-1 rounded-lg border bg-background p-3 text-xs">
              <p><strong>Assigned:</strong> {assignedName}</p>
              <p><strong>Priority:</strong> {assignment.priority}</p>
              <p><strong>Next review:</strong> {new Date(assignment.next_action_at).toLocaleString("en-US")}</p>
              {status !== "RESOLVED" && new Date(assignment.next_action_at).getTime() < Date.now() && (
                <p role="status" className="flex items-center gap-1 font-extrabold text-destructive">
                  <ShieldAlert className="size-3.5" aria-hidden /> Overdue staff review
                </p>
              )}
            </div>
          )}
          {resolved ? (
            <p className="text-xs text-muted-foreground">This case is resolved. Assignment changes are closed; post-resolution staff notes remain available.</p>
          ) : operators.length === 0 ? (
            <p role="alert" className="text-sm text-destructive">No authorized dispute agents available. An owner must assign a qualified staff role.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-bold sm:col-span-2">
                <span>Responsible employee</span>
                <select className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={assignee}
                  disabled={pending} onChange={(event) => setAssignee(event.target.value)}>
                  {operators.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold">
                <span>Priority</span>
                <select className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={priority}
                  disabled={pending} onChange={e => setPriority(e.target.value as typeof priority)}>
                  <option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option>
                </select>
              </label>
              <label className="space-y-1 text-xs font-bold">
                <span>Next review within</span>
                <select className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={target}
                  disabled={pending} onChange={e => setTarget(Number(e.target.value) as typeof target)}>
                  <option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option>
                </select>
              </label>
              <Button className="sm:col-span-2" disabled={pending || !assignee}
                type="button" onClick={submitAssignment}>{pending ? "Saving…" : "Save assignment"}</Button>
            </div>
          )}
        </div>
        <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
          <h3 className="flex items-center gap-2 text-sm font-black"><MessageSquareText className="size-4" aria-hidden /> Confidential case note</h3>
          <label htmlFor={`private-note-${disputeId}`} className="text-xs leading-5 text-muted-foreground">
            Record evidence assessment, follow-up, or escalation. Do not paste customer financial secrets.
          </label>
          <Textarea id={`private-note-${disputeId}`} value={note}
            disabled={pending} maxLength={3000} rows={5}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Internal only — verified facts and next action…" />
          <Button type="button" variant="outline" disabled={pending || note.trim().length < 10}
            onClick={submitNote}>{pending ? "Saving…" : "Save confidential note"}</Button>
        </div>
      </div>
      {feedback && (
        <p role={feedback.ok ? "status" : "alert"}
          className={feedback.ok
            ? "rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
            : "rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs font-semibold text-destructive"}>
          {feedback.message}
        </p>
      )}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-black"><CalendarClock className="size-4" aria-hidden /> Internal activity timeline</h3>
        {activity.length === 0 ? <p className="text-xs text-muted-foreground">No private case operations have been recorded yet.</p> :
          <ol className="space-y-2">
            {activity.map((entry) => (
              <li key={entry.id} className="rounded-lg border bg-background p-3 text-xs">
                <div className="flex flex-wrap justify-between gap-2 font-bold">
                  <span>{entry.event_type.replaceAll("_", " ")}</span>
                  <time className="font-normal text-muted-foreground" dateTime={entry.created_at}>
                    {new Date(entry.created_at).toLocaleString("en-US")}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap leading-5 text-muted-foreground">{entry.description}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  By {operators.find((person) => person.id === entry.actor_id)?.name ?? "Former authorized staff"}
                </p>
              </li>
            ))}
          </ol>}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        A case assignment, deadline, or private note never releases seller money, resolves a dispute, or creates a refund.
      </p>
    </section>
  );
}
