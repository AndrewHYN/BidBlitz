"use client";

import { useState } from "react";
import { Check, ClipboardCopy, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FinanceTransferSlip({
  amountMinor, currency, recipient, destination, rail, reference, reason,
  editableDestination = false,
}: {
  amountMinor: number;
  currency: string;
  recipient: string;
  destination?: string | null;
  rail: string;
  reference: string;
  reason: string;
  editableDestination?: boolean;
}) {
  const [manualDestination, setManualDestination] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const target = editableDestination ? manualDestination.trim() : (destination ?? "");
  const valid = Number.isSafeInteger(amountMinor) && amountMinor > 0 && currency === "USD";
  const amount = valid ? (amountMinor / 100).toFixed(2) : null;
  const note = `BidBlitz transfer worksheet (NOT a payment instruction)
Recipient: ${recipient}
Destination: ${target || "Verify before transfer"}
Rail: ${rail}
Exact amount: USD ${amount ?? "unavailable"}
Internal reference: ${reference}
Purpose: ${reason}
Only use funds owned by the business, not another seller's allocated proceeds.
After a separate wallet/bank transfer, independently verify recipient receipt and record the real provider reference in BidBlitz.`;

  async function copy() {
    if (!valid || !target) return;
    try {
      await navigator.clipboard.writeText(note);
      setCopied(true); setError(false);
    } catch {
      setError(true); setCopied(false);
    }
  }

  return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="External transfer worksheet">
    <div>
      <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Exact transfer worksheet</p>
      <p className="mt-1 text-sm font-bold">{amount === null ? "Amount unavailable" : `USD ${amount}`} · {rail}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">This prepares details for an authorized finance operator. It never initiates a payment.</p>
    </div>
    {editableDestination && <label className="block space-y-1 text-xs font-bold">
      Actual wallet / bank destination (used only for the clipboard worksheet)
      <input className="h-11 w-full rounded-lg border bg-background px-3 text-sm" value={manualDestination}
        maxLength={160} autoComplete="off" onChange={e => { setManualDestination(e.target.value); setCopied(false); }}
        placeholder="Verify the payee's number or bank account first" />
    </label>}
    {!editableDestination && <div className="text-xs">
      <p className="text-muted-foreground">Frozen recipient destination</p>
      <p className="mt-1 break-all font-mono font-bold">{destination || "Unavailable"}</p>
    </div>}
    <Button size="sm" type="button" variant="outline" disabled={!valid || !target} onClick={copy}>
      {copied ? <Check className="mr-2 size-4" aria-hidden /> : <ClipboardCopy className="mr-2 size-4" aria-hidden />}
      {copied ? "Transfer details copied" : "Copy exact transfer details"}
    </Button>
    {error && <p role="alert" className="text-xs text-destructive">Clipboard access failed. Check browser permissions.</p>}
    <p className="flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      Do not paste this as a new API payout request. Check destination, funds and amount inside your wallet or bank. Save the actual receipt after confirmed delivery.
    </p>
  </section>;
}
