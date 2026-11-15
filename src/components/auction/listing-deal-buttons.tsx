"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, BriefcaseBusiness } from "lucide-react";
import { parseMoneyToMinor } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { makeListingOfferAction, requestServiceHireAction } from "@/server/actions/marketplace-deals";

export function ListingDealButtons({ listingId, kind }: { listingId: string; kind: "SALE" | "SERVICE" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = kind === "SALE"
          ? await makeListingOfferAction({
              listingId, amountMinor: Number(parseMoneyToMinor(amount) ?? 0n),
            })
          : await requestServiceHireAction({ listingId, details });
        if (result.ok) {
          router.push(result.conversationId ? `/messages/${result.conversationId}` : "/messages");
        } else setError(result.message);
      } catch {
        setError("Could not send your request. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <Button type="button" size="lg" variant="outline" className="w-full min-h-11" aria-expanded={open}
        onClick={() => { setError(null); setOpen((value) => !value); }}>
        {kind === "SALE" ? <HandCoins aria-hidden /> : <BriefcaseBusiness aria-hidden />}
        {kind === "SALE" ? "Make an offer" : "Request to hire"}
      </Button>
      {open && (
        <form method="post" onSubmit={submit} className="space-y-3 rounded-lg border bg-background p-4">
          {kind === "SALE" ? (
            <div className="space-y-1">
              <label htmlFor="deal-price" className="text-sm font-medium">Your offer (US$)</label>
              <Input id="deal-price" inputMode="decimal" value={amount}
                onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 75.00" required />
              <p className="text-xs text-muted-foreground">The seller may accept or decline. This does not send money.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <label htmlFor="hire-details" className="text-sm font-medium">Describe the job you need</label>
              <Textarea id="hire-details" value={details} rows={4}
                onChange={(event) => setDetails(event.target.value.slice(0, 2000))}
                maxLength={2000} minLength={10} required
                placeholder="What work is needed, preferred date, and where?" />
              <p className="text-xs text-muted-foreground">The provider reviews your request; no payment is collected here.</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Sending…" : kind === "SALE" ? "Send offer" : "Send hire request"}</Button>
        </form>
      )}
    </div>
  );
}
