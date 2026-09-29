"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { duplicateAuctionAction } from "@/server/actions/auction";
import { Button } from "@/components/ui/button";

/**
 * List an unsold auction again. Copies the closed listing into a new draft and
 * takes the seller straight to it, where photos and publishing work exactly as
 * they do for a fresh draft.
 *
 * The failure message names the outcome rather than the mechanism: a seller
 * whose relist is refused needs to know whether it was their auction, its
 * state, or the rate limit - not a request id.
 */
export function RelistButton({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await duplicateAuctionAction({ auctionId });
              if (result.ok) {
                router.push(`/sell/${result.auctionId}`);
                return;
              }
              setError(
                result.rejection.message ??
                  "That listing can't be started again right now."
              );
            } catch {
              setError("We couldn't start a new draft. Please try again.");
            }
          });
        }}
      >
        {pending ? "Starting…" : "List again"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
