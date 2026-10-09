"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "./money";
import { submitMaxBidAction, decideMaxBidAction } from "@/server/actions/max-bid";
import type { MaxBidOffer } from "@/server/max-bid-queries";

export function MaxBidPanel({ auctionId, sellerId, viewerId, status, endsAt, currentBidMinor, currentBidderId, minimumMinor, offers }: {
  auctionId: string; sellerId: string; viewerId: string | null; status: string; endsAt: string | null;
  currentBidMinor: number | null; currentBidderId: string | null; minimumMinor: string; offers: MaxBidOffer[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [decision, setDecision] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef<string | null>(null);
  const live = status === "LIVE" && !!endsAt;
  const seller = viewerId === sellerId;
  function decide(offerId: string, accept: boolean) {
    startTransition(async () => {
      try {
        const result = await decideMaxBidAction({ offerId, accept, confirmed: true });
        setMessage(result.ok ? accept ? "Sale confirmed. The buyer must now pay before handover." : "Early purchase declined. The bid remains in the auction." : result.message);
        if (result.ok) { setDecision(null); router.refresh(); }
      } catch { setMessage("The result could not be confirmed. Refresh before trying again."); }
    });
  }
  return <section className="rounded-xl border bg-card p-5 space-y-4" aria-labelledby="max-bid-heading">
    <div><h2 id="max-bid-heading" className="font-semibold">Max Bid · buy sooner</h2>
      <p className="mt-1 text-sm text-muted-foreground">Place a binding bid and ask the seller to finish early. The timer stops only when the seller accepts the current highest bid.</p></div>
    {!seller && live && (viewerId ? <form method="post" className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (!/^\d+(\.\d{1,2})?$/.test(amount)) { setMessage("Enter a USD amount with up to two decimal places."); return; }
      const [whole, fraction = ""] = amount.split(".");
      const minor = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
      request.current ??= crypto.randomUUID();
      startTransition(async () => {
        try {
          const result = await submitMaxBidAction({ auctionId, amountMinor: minor, requestId: request.current, bindingBidConfirmed: confirmed });
          setMessage(result.ok ? "Max Bid sent. The seller can accept it while it remains the highest bid." : result.message);
          if (result.ok) { request.current = null; setAmount(""); setConfirmed(false); router.refresh(); }
        } catch { setMessage("The result could not be confirmed. Refresh before retrying the same bid."); }
      });
    }}>
      <label htmlFor="max-bid-amount" className="block text-sm font-medium">Your Max Bid (USD)</label>
      <Input id="max-bid-amount" inputMode="decimal" maxLength={16} value={amount} disabled={pending} onChange={(event) => { setAmount(event.target.value); request.current = null; }} placeholder="0.00" required />
      <p className="text-xs text-muted-foreground">Minimum: <Money minor={minimumMinor} />. A declined or ignored offer remains a normal binding bid.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />I agree to buy at this amount if the seller accepts or I win the auction.</label>
      <Button disabled={pending || !confirmed} type="submit">{pending ? "Sending…" : "Send Max Bid"}</Button>
    </form> : <Link className="text-sm font-medium underline" href={`/login?next=/auction/${auctionId}`}>Sign in to send a Max Bid</Link>)}
    {offers.map((offer) => {
      const eligible = live && offer.status === "PENDING" && currentBidderId === offer.buyer_id && currentBidMinor === offer.amount_minor;
      return <div key={offer.id} className="border-t pt-3 space-y-2">
        <p className="text-sm"><Money minor={offer.amount_minor} /> · {offer.status.toLowerCase()}</p>
        {seller && offer.status === "PENDING" && <>
          {!eligible && <p className="text-xs text-muted-foreground">Only the current highest bid in a live auction can be accepted.</p>}
          {decision === offer.id ? <div className="space-y-2"><p className="text-sm">End this auction now and sell for <Money minor={offer.amount_minor} />? Payment and buyer-confirmed handover are still required.</p><div className="flex flex-wrap gap-2"><Button disabled={pending || !eligible} onClick={() => decide(offer.id, true)}>Confirm sale</Button><Button variant="outline" disabled={pending} onClick={() => setDecision(null)}>Cancel</Button></div></div>
            : <div className="flex flex-wrap gap-2"><Button disabled={pending || !eligible} onClick={() => setDecision(offer.id)}>Accept and end auction</Button><Button variant="outline" disabled={pending} onClick={() => decide(offer.id, false)}>Decline early purchase</Button></div>}
        </>}
        {offer.transaction_id && <Link className="text-sm underline" href={`/dashboard/transactions/${offer.transaction_id}`}>View sale</Link>}
      </div>;
    })}
    {message && <p role="status" className="text-sm">{message}</p>}
    {!live && <p className="text-sm text-muted-foreground">Early purchase offers are available while the auction is live.</p>}
  </section>;
}
