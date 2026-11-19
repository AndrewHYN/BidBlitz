"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitPeerReview } from "@/server/actions/community";

export function PeerReviewForm({ peerId, name }: { peerId: string; name: string }) {
  const [result, action, pending] = useActionState(submitPeerReview, "");
  return <details className="rounded-xl border bg-card p-4">
    <summary className="cursor-pointer font-semibold text-primary">Rate your interaction with {name}</summary>
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="peer" value={peerId} />
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Rating out of five</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map(value => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 has-checked:border-primary has-checked:bg-primary/10">
            <input type="radio" name="rating" value={value} required /> {value}
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
