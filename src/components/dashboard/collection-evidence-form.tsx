"use client";

import { useId, useState, useTransition } from "react";
import { recordMerchantCollectionAction } from "@/server/actions/collection-evidence";
import { Button } from "@/components/ui/button";

export function CollectionEvidenceForm({ transactionId }: { transactionId: string }) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const field = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return <details className="mt-3 rounded-lg border p-3 text-sm">
    <summary className="min-h-9 cursor-pointer py-1 font-semibold text-primary focus-visible:outline-2 focus-visible:outline-ring">Verify merchant receipt</summary>
    <form method="post" className="mt-3 space-y-3" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setMessage(null);
      startTransition(async () => {
        try {
          const result = await recordMerchantCollectionAction({
            transactionId, collectionReference: data.get("collectionReference"),
            receivedAmount: data.get("receivedAmount"), currency: "USD",
            settlementReference: data.get("settlementReference"), source: data.get("source"),
            note: data.get("note"), fundsReceived: data.get("fundsReceived") === "on",
          });
          setMessage(result.ok ? { ok: true, text: result.already ? "This receipt was already verified." : "Merchant receipt verified. Handover and payout checks still apply." }
            : { ok: false, text: result.message });
        } catch {
          setMessage({ ok: false, text: "The result could not be confirmed. Reload this sale to check for recorded evidence." });
        }
      });
    }}>
      <p className="text-xs leading-5 text-muted-foreground">Match the sale to the settled merchant statement or money received in BidBlitz&apos;s wallet. Pending balances and buyer screenshots do not qualify. Record one exact settlement per sale.</p>
      <label htmlFor={`${id}-collection`} className="block text-xs font-semibold">Collection reference
        <input id={`${id}-collection`} name="collectionReference" className={field} required maxLength={200} disabled={pending} autoComplete="off" /></label>
      <label htmlFor={`${id}-amount`} className="block text-xs font-semibold">Gross received (USD)
        <input id={`${id}-amount`} name="receivedAmount" inputMode="decimal" className={field} required maxLength={30} disabled={pending} autoComplete="off" /></label>
      <label htmlFor={`${id}-source`} className="block text-xs font-semibold">Evidence source
        <select id={`${id}-source`} name="source" className={field} required disabled={pending} defaultValue="">
          <option value="" disabled>Select the record reviewed</option><option value="MERCHANT_WALLET_RECEIPT">Merchant wallet receipt</option><option value="MERCHANT_STATEMENT">Settled merchant statement</option>
        </select></label>
      <label htmlFor={`${id}-settlement`} className="block text-xs font-semibold">Settlement / wallet receipt reference
        <input id={`${id}-settlement`} name="settlementReference" className={field} required minLength={6} maxLength={200} disabled={pending} autoComplete="off" /></label>
      <label htmlFor={`${id}-note`} className="block text-xs font-semibold">How this receipt matches this sale
        <textarea id={`${id}-note`} name="note" className={field} required minLength={25} maxLength={1500} rows={3} disabled={pending} /></label>
      <label className="flex min-h-11 cursor-pointer items-start gap-2 text-xs leading-5"><input name="fundsReceived" type="checkbox" required disabled={pending} className="mt-1 size-4 shrink-0" />I verified that BidBlitz received this sale&apos;s exact amount and currency.</label>
      <Button type="submit" disabled={pending}>{pending ? "Verifying…" : "Record verified receipt"}</Button>
      {message && <p role={message.ok ? "status" : "alert"} className="rounded-md border p-3 text-xs leading-5">{message.text}</p>}
    </form>
  </details>;
}
