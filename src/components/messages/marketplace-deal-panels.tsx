"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Money } from "@/components/auction/money";
import {
  respondListingOfferAction,
  respondServiceHireAction,
  reviewCompletedServiceAction,
} from "@/server/actions/marketplace-deals";

type Offer = {
  id: string; amount_minor: number; status: "PENDING" | "ACCEPTED" | "DECLINED";
  buyer_id: string; seller_id: string; created_at: string;
};
type Hire = {
  id: string; details: string; status: "REQUESTED" | "ACCEPTED" | "DECLINED" | "DELIVERED" | "COMPLETED" | "CANCELLED";
  client_id: string; provider_id: string; created_at: string;
};

export function MarketplaceDealPanels({
  viewerId, offers, hires, reviewedRequestIds,
}: {
  viewerId: string;
  offers: Offer[];
  hires: Hire[];
  reviewedRequestIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");

  function act(run: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) setError(result.message);
        else router.refresh();
      } catch {
        setError("Could not update this request. Please try again.");
      }
    });
  }

  if (offers.length === 0 && hires.length === 0) return null;
  return (
    <section className="space-y-4" aria-label="Offers and service hire requests">
      <h2 className="text-lg font-semibold">Offers and hire requests</h2>
      {error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      {offers.map((offer) => {
        const isSeller = offer.seller_id === viewerId;
        return (
          <article key={offer.id} className="space-y-2 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">Offer: <Money minor={offer.amount_minor} /></span>
              <span className="text-xs font-semibold text-muted-foreground">{offer.status}</span>
            </div>
            {offer.status === "PENDING" && isSeller && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={pending}
                  onClick={() => act(() => respondListingOfferAction({ offerId: offer.id, accept: true }))}>Accept offer</Button>
                <Button type="button" size="sm" variant="outline" disabled={pending}
                  onClick={() => act(() => respondListingOfferAction({ offerId: offer.id, accept: false }))}>Decline</Button>
              </div>
            )}
            {offer.status === "ACCEPTED" && <p className="text-xs text-muted-foreground">
              Agreed in chat only. No payment has moved. Arrange collection and mark the listing sold when completed.
            </p>}
          </article>
        );
      })}
      {hires.map((hire) => {
        const provider = hire.provider_id === viewerId;
        const client = hire.client_id === viewerId;
        const actions: Array<{ text: string; key: "ACCEPT" | "DECLINE" | "DELIVER" | "CONFIRM" | "CANCEL" }> = [];
        if (provider && hire.status === "REQUESTED") actions.push({ text: "Accept job", key: "ACCEPT" }, { text: "Decline", key: "DECLINE" });
        if (provider && hire.status === "ACCEPTED") actions.push({ text: "Mark work delivered", key: "DELIVER" });
        if (client && hire.status === "DELIVERED") actions.push({ text: "Confirm complete", key: "CONFIRM" });
        if (client && (hire.status === "REQUESTED" || hire.status === "ACCEPTED")) actions.push({ text: "Cancel request", key: "CANCEL" });
        const canReview = client && hire.status === "COMPLETED" && !reviewedRequestIds.includes(hire.id);
        return (
          <article key={hire.id} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Service hire</h3>
              <span className="text-xs font-semibold text-muted-foreground">{hire.status}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{hire.details}</p>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.map((action) => (
                  <Button key={action.key} type="button" size="sm" variant={action.key === "DECLINE" || action.key === "CANCEL" ? "outline" : "default"}
                    disabled={pending} onClick={() => act(() => respondServiceHireAction({ requestId: hire.id, action: action.key }))}>
                    {action.text}
                  </Button>
                ))}
              </div>
            )}
            {canReview && (
              <div className="space-y-2">
                {reviewFor !== hire.id ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setReviewFor(hire.id)}>Review completed service</Button>
                ) : (
                  <form method="post" className="space-y-2"
                    onSubmit={(event) => { event.preventDefault(); act(() => reviewCompletedServiceAction({ requestId: hire.id, rating: Number(rating), comment })); }}>
                    <label htmlFor={`rating-${hire.id}`} className="block text-sm font-medium">Rating</label>
                    <select id={`rating-${hire.id}`} className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={rating} onChange={(event) => setRating(event.target.value)}>
                      {[5,4,3,2,1].map((score) => <option key={score} value={score}>{score} stars</option>)}
                    </select>
                    <label htmlFor={`review-${hire.id}`} className="block text-sm font-medium">Review (optional)</label>
                    <Textarea id={`review-${hire.id}`} rows={3} maxLength={1000} value={comment}
                      onChange={(event) => setComment(event.target.value)} />
                    <Button type="submit" size="sm" disabled={pending}>Publish verified review</Button>
                  </form>
                )}
              </div>
            )}
            {reviewedRequestIds.includes(hire.id) && <p className="text-xs text-muted-foreground">Verified review submitted</p>}
          </article>
        );
      })}
    </section>
  );
}
