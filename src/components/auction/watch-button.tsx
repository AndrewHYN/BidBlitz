"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toggleWatchAction } from "@/server/actions/social";

/**
 * Watchlist toggle. Optimistic in the UI, authoritative in the action: a
 * rejection reverts the button and explains why (signed-out viewers are told
 * to sign in rather than silently failing).
 */
export function WatchButton({
  auctionId,
  initialWatched,
  viewerId,
}: {
  auctionId: string;
  initialWatched: boolean;
  viewerId: string | null;
}) {
  const router = useRouter();
  const [watched, setWatched] = useState(initialWatched);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    const next = !watched;
    setWatched(next);
    setPending(true);
    try {
      const result = await toggleWatchAction({ auctionId, watched: next });
      if (result.ok) {
        setWatched(result.watched);
        toast.success(
          result.watched ? "Added to your watchlist" : "Removed from your watchlist",
          { description: result.watched ? "Find it under Dashboard → Watchlist." : undefined }
        );
        if (viewerId === null) router.refresh();
        return;
      }
      setWatched(!next);
      toast.info(result.rejection.message);
    } catch {
      setWatched(!next);
      toast.error("Couldn't update your watchlist. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      data-testid="watch-button"
      variant={watched ? "default" : "outline"}
      size="lg"
      aria-pressed={watched}
      disabled={pending}
      onClick={toggle}
      className="w-full sm:w-auto"
    >
      <Eye aria-hidden />
      {watched ? "Watching" : "Watch"}
    </Button>
  );
}
