"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Eye } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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
  compact = false,
}: {
  auctionId: string;
  initialWatched: boolean;
  viewerId: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [watched, setWatched] = useState(initialWatched);
  const [pending, setPending] = useState(false);
  const reduceMotion = useReducedMotion();
  const Icon = compact ? Bookmark : Eye;

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
          { description: result.watched ? "Find it under Saved items." : undefined }
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
      aria-label={compact ? "Watch listing" : undefined}
      title={compact ? (watched ? "Remove from Saved items" : "Watch listing") : undefined}
      disabled={pending}
      onClick={toggle}
      className={compact ? "size-11 p-0" : "w-full sm:w-auto"}
    >
      {/* One pulse when the watch lands — transform only, no-op under
          reduced motion. The toast is the textual confirmation. */}
      <motion.span
        aria-hidden
        animate={watched && !reduceMotion ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <Icon fill={compact && watched ? "currentColor" : "none"} />
      </motion.span>
      {!compact && (watched ? "Watching" : "Watch")}
    </Button>
  );
}
