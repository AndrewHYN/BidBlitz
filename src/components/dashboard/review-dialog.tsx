"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { reviewSchema } from "@/lib/validation";
import { submitReviewAction } from "@/server/actions/social";

/**
 * One review per side, per transaction — the same contract the server and RLS
 * enforce; this only gives instant feedback. The star picker is a native
 * radio group (arrow keys, one tab stop), with the stars as decoration over
 * real inputs.
 */
export function ReviewDialog({
  transactionId,
  auctionTitle,
  counterpartyRole,
}: {
  transactionId: string;
  auctionTitle: string;
  /** Who the review is ABOUT: the other side of this sale. */
  counterpartyRole: "buyer" | "seller";
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (rating < 1) {
      setError("Pick a star rating first.");
      return;
    }

    const parsed = reviewSchema.safeParse({
      transactionId,
      rating,
      comment: comment.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid review.");
      return;
    }

    setPending(true);
    try {
      const result = await submitReviewAction(parsed.data);
      if (result.ok) {
        toast.success("Review submitted", {
          description: "It shows on their profile alongside your rating.",
        });
        setRating(0);
        setComment("");
        setOpen(false);
      } else {
        setError(result.rejection.message);
      }
    } catch {
      setError("Couldn't submit your review. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          data-testid="leave-review-button"
          variant="outline"
          size="sm"
        >
          <Star aria-hidden />
          Leave a review
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave a review</DialogTitle>
          <DialogDescription>
            How did the {counterpartyRole} do on “{auctionTitle}”? Your rating
            appears on their profile.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium leading-none">
              Your rating
            </legend>
            <div className="flex items-center gap-1 pt-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="cursor-pointer">
                  <input
                    type="radio"
                    name={`review-rating-${transactionId}`}
                    value={n}
                    checked={rating === n}
                    onChange={() => {
                      setRating(n);
                      setError(null);
                    }}
                    className="peer sr-only"
                  />
                  <Star
                    className={cn(
                      "size-7 text-muted-foreground transition-colors",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                      n <= rating && "fill-primary text-primary"
                    )}
                    aria-hidden
                  />
                  <span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={`review-comment-${transactionId}`}>
              Comment <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={`review-comment-${transactionId}`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="What went well, or what didn't?"
              aria-invalid={error ? true : undefined}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} data-testid="review-submit">
              {pending ? "Submitting…" : "Submit review"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
