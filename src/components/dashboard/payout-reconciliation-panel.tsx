"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ClipboardList, FileSearch, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordPayoutReconciliationAction } from "@/server/actions/payout-reconciliation";

export type ReconciliationEvidence = {
  id: string;
  payout_id: string;
  evidence_kind: "INVESTIGATION" | "PROVIDER_REFERENCE" | "SELLER_RECEIPT";
  provider_reference: string | null;
  evidence_note: string;
  seller_receipt_verified: boolean;
  recorded_at: string;
};

export function PayoutReconciliationPanel({
  payoutId, savedReference, entries, canRecord,
}: {
  payoutId: string;
  savedReference: string | null;
  entries: ReconciliationEvidence[];
  canRecord: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ReconciliationEvidence["evidence_kind"]>("INVESTIGATION");
  const [reference, setReference] = useState(savedReference ?? "");
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(false);
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const receipt = entries.find(e => e.evidence_kind === "SELLER_RECEIPT" && e.seller_receipt_verified);
  const records = entries.slice().sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));

  function submit() {
    if (pending) return;
    setFeedback(null);
    start(async () => {
      try {
        const result = await recordPayoutReconciliationAction({
          payoutId, kind, reference: kind === "INVESTIGATION" ? "" : reference,
          note, sellerReceiptVerified: kind === "SELLER_RECEIPT" && verified,
        });
        setFeedback({ ok: result.ok, message: result.ok
          ? "Evidence saved permanently. No money was sent and the payout is not automatically marked paid."
          : result.message });
        if (result.ok) {
          setNote(""); setVerified(false);
          router.refresh();
        }
      } catch {
        setFeedback({ ok: false, message: "Recording outcome is uncertain. Refresh the ledger before submitting the same evidence again." });
      }
    });
  }

  return <section className="space-y-4 rounded-xl border border-amber-500/35 bg-amber-500/[.045] p-4" data-testid="payout-reconciliation-panel">
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"><FileSearch className="size-5" aria-hidden /></span>
      <div>
        <h4 className="font-extrabold text-sm">Provider payout investigation</h4>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          A provider instruction may already have been accepted. Do not submit another payout or reserve a second wallet transfer.
          Find the actual provider debit and seller-wallet receipt, then document what was verified.
        </p>
      </div>
    </div>
    {!savedReference && <p role="alert" className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      No provider reference was recorded. This does not prove failure. Ask Linkwa for transaction-level evidence and check the original destination wallet.
    </p>}
    {receipt && <p role="status" className="flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
      A finance operator has documented verified receipt (reference {receipt.provider_reference}). The owner may complete the separate payout status review.
    </p>}
    <ol className="list-decimal space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
      <li>Read the Linkwa statement above; a missing item on one page is inconclusive.</li>
      <li>Match exact destination, amount and provider reference with the provider and receiving seller.</li>
      <li>Record the evidence. Only independently confirmed receipt may justify PAID_OUT.</li>
    </ol>
    {canRecord && <div className="space-y-3 rounded-lg border bg-card p-4">
      <label className="block space-y-1.5 text-xs font-bold">Evidence type
        <select className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={kind}
          onChange={e => { setKind(e.target.value as ReconciliationEvidence["evidence_kind"]); setVerified(false); }}>
          <option value="INVESTIGATION">Investigation / unanswered provider query</option>
          <option value="PROVIDER_REFERENCE">Provider confirmed the original instruction reference</option>
          <option value="SELLER_RECEIPT">Seller independently confirmed actual wallet receipt</option>
        </select>
      </label>
      {kind !== "INVESTIGATION" && <label className="block space-y-1.5 text-xs font-bold">
        Exact original provider reference
        <input className="h-11 w-full rounded-lg border bg-background px-3 text-sm" maxLength={200}
          value={reference} onChange={e => setReference(e.target.value)}
          placeholder="Actual provider reference, never a made-up ID" />
      </label>}
      <label className="block space-y-1.5 text-xs font-bold">Evidence note
        <textarea className="min-h-24 w-full rounded-lg border bg-background p-3 text-sm" rows={3} maxLength={1500}
          value={note} onChange={e => setNote(e.target.value)}
          placeholder="Source, provider contact, exact amount, time, recipient confirmation and what remains unknown" />
      </label>
      {kind === "SELLER_RECEIPT" && <label className="flex gap-2 text-xs leading-5">
        <input className="mt-0.5 size-4 accent-primary" type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />
        <span>I independently verified that the seller actually received the frozen payout amount in their destination wallet. A provider POST alone is not sufficient.</span>
      </label>}
      <Button type="button" disabled={pending || note.trim().length < 25
        || (kind !== "INVESTIGATION" && reference.trim().length < 6)
        || (kind === "SELLER_RECEIPT" && !verified)} onClick={submit}>
        <ShieldCheck className="mr-2 size-4" aria-hidden />
        {pending ? "Recording evidence…" : "Save reconciliation evidence"}
      </Button>
      {feedback && <p role={feedback.ok ? "status" : "alert"}
        className={feedback.ok ? "text-xs font-semibold text-emerald-700 dark:text-emerald-300" : "text-xs text-destructive"}>
        {feedback.message}
      </p>}
    </div>}
    {records.length > 0 && <details className="border-t pt-3">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-bold"><ClipboardList className="size-4" aria-hidden/>Evidence history ({records.length})</summary>
      <ul className="mt-3 space-y-2">
        {records.map(e => <li key={e.id} className="rounded-lg border bg-card p-3 text-xs leading-5">
          <p className="font-bold">{e.evidence_kind.replaceAll("_", " ")} · {new Date(e.recorded_at).toLocaleString("en-US")}</p>
          {e.provider_reference && <p className="break-all font-mono text-muted-foreground">Reference: {e.provider_reference}</p>}
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{e.evidence_note}</p>
        </li>)}
      </ul>
    </details>}
  </section>;
}
