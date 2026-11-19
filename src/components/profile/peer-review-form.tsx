"use client";

import { useActionState } from "react";
import { ChevronDown, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitPeerReview } from "@/server/actions/community";

export function PeerReviewForm({ peerId, name }: { peerId: string; name: string }) {
  const [result, action, pending] = useActionState(submitPeerReview, "");
  return <details className="group/rating rounded-xl border bg-card px-4">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-semibold"><Star className="size-4 shrink-0 text-primary" aria-hidden />Rate your interaction with {name}<ChevronDown className="ml-auto size-4 shrink-0 group-open/rating:rotate-180" aria-hidden /></summary>
    <form action={action} className="space-y-4 pb-4">
      <input type="hidden" name="peer" value={peerId} />
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Rating out of five</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map(value => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 has-focus-visible:outline-2 has-focus-visible:outline-ring has-checked:text-primary has-checked:border-primary has-checked:bg-primary/10">
            <input type="radio" name="rating" value={value} required className="sr-only" aria-label={`${value} out of 5 stars`} /><Star className="size-4" aria-hidden />{value}
          </label>)}
        </div>
      </fieldset>
      <label className="block space-y-1 text-sm font-medium"><span>Written review (optional)</span><Textarea name="comment" maxLength={1000} rows={3} /></label>
      <p className="text-xs text-muted-foreground">Your rating and review will appear publicly under your name. Keep private chat details out of your review.</p>
      {result && <p role="status" className="text-sm">{result}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Publishing…" : "Publish rating"}</Button>
    </form>
  </details>;
}
