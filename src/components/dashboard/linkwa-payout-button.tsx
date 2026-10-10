"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { initiateLinkwaPayoutAction } from "@/server/actions/linkwa-payouts";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/auction/money";

/** Sends exactly ONE server-authorized instruction, never assumes settlement. */
export function LinkwaPayoutButton({ payoutId, amountMinor, currency }: {
  payoutId: string; amountMinor: number; currency: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function send() {
    if (!confirm || pending) return;
    startTransition(async () => {
      try {
        const response = await initiateLinkwaPayoutAction({ payoutId });
        if (response.ok) {
          setSuccess(true);
          setResult("Linkwa accepted the payout instruction. Reference: " + response.payoutReference +
            ". This is NOT proof that the seller has received money. Reconcile before marking paid.");
          setConfirm(false);
          router.refresh();
        } else {
          setSuccess(false);
          setResult(response.message);
        }
      } catch {
        setSuccess(false);
        setResult("Payout outcome is not confirmed. Do NOT retry until you have checked the provider statement.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {!confirm && !success && (
        <Button type="button" size="sm" onClick={() => { setResult(null); setConfirm(true); }}>
          Instruct Linkwa payout <ArrowUpRight className="ml-1 size-4" aria-hidden />
        </Button>
      )}
      {confirm && (
        <div className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/5 p-4" data-testid="linkwa-confirm">
          <p className="flex gap-2 text-sm font-bold"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Instruct exactly <Money minor={amountMinor} currency={currency} /> to the seller&apos;s linked wallet?
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            This sends a real provider request when payments are enabled. The destination
            and frozen amount come from the database. An ambiguous response must never
            be retried automatically. An accepted instruction is not a confirmed receipt.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} aria-busy={pending} onClick={send}>
              {pending ? "Instructing…" : "Confirm one payout instruction"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {result && (
        <p role={success ? "status" : "alert"} className={
          success ? "flex gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-700 dark:text-emerald-300"
            : "rounded-lg bg-destructive/10 p-3 text-xs leading-5 text-destructive"
        }>
          {success && <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />}
          {result}
        </p>
      )}
    </div>
  );
}
