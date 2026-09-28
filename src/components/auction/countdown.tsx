"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { countdownParts, formatRemaining, ENDING_SOON_MS } from "@/lib/clock";
import { isClosed } from "@/lib/auction-status";
import { useNow } from "@/components/clock-provider";

/**
 * Ticking countdown, rendered from the SERVER clock offset.
 *
 * The number on screen is decoration — Postgres decides when an auction is
 * over — but it must never be computed from an unsynchronised device clock,
 * otherwise a user with a fast clock would be shown a different race than
 * everyone else.
 */

export function useEndingSoon(endsAt: string | null | undefined, status: string): boolean {
  const now = useNow();
  if (!endsAt || isClosed(status)) return false;
  const remaining = Date.parse(endsAt) - now;
  return remaining > 0 && remaining <= ENDING_SOON_MS * 10;
}

export function Countdown({
  endsAt,
  status = "LIVE",
  variant = "compact",
  className,
  onExpire,
}: {
  endsAt: string | null | undefined;
  status?: string;
  variant?: "compact" | "boxes" | "large";
  className?: string;
  /** Fires once when the displayed remaining time crosses zero. */
  onExpire?: () => void;
}) {
  const now = useNow();
  const fired = useRef(false);

  const closed = isClosed(status);
  const parts = endsAt ? countdownParts(endsAt, now) : null;

  useEffect(() => {
    if (!parts?.expired || fired.current || !onExpire) return;
    fired.current = true;
    onExpire();
  }, [parts?.expired, onExpire]);

  if (!endsAt) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)} data-countdown="none">
        No end time
      </span>
    );
  }

  if (closed) {
    return (
      <span className={cn("text-sm font-medium text-muted-foreground", className)} data-countdown="closed">
        {status === "CANCELLED" ? "Cancelled" : "Auction closed"}
      </span>
    );
  }

  if (parts?.expired) {
    return (
      <span className={cn("text-sm font-medium text-muted-foreground", className)} data-countdown="expired">
        Ended · awaiting results
      </span>
    );
  }

  const urgent = Boolean(parts?.endingSoon);

  if (variant === "boxes" || variant === "large") {
    /*
     * One reading, not one box per unit.
     *
     * This rendered minutes and seconds as separate bordered cards, each with a
     * 10px uppercase unit letter underneath, so the most time-sensitive number
     * on the page read as "59 M" in one box and "13 S" in another. The eye had
     * to cross a gap and infer the order; the boxes added two more frames to a
     * panel that already had three; and `min-w-12` on a digit that changes
     * every second made the whole group twitch as the numbers grew and shrank.
     *
     * A clock should read like a clock. "2d 4h" or "58m 13s" in one run of
     * tabular numerals is legible in a single glance, has nothing to jitter,
     * and leaves the panel quieter. Urgency is carried by colour and weight -
     * the same information the old boxes carried, without the furniture.
     */
    const label = formatRemaining(endsAt, now);
    return (
      <span
        data-countdown="boxes"
        data-urgent={urgent ? "true" : undefined}
        role="timer"
        aria-label={`Time remaining: ${label}`}
        // Hydration guard: the digits are computed from `now`, so a second
        // boundary crossing between SSR and hydration makes the two renders
        // differ (observed: 59m 34s vs 59m 33s -> React hydration error). The
        // server snapshot is stale by definition; React is told to trust the
        // client for these nodes instead of discarding the tree.
        suppressHydrationWarning
        className={cn(
          "inline-flex items-baseline tabular-nums",
          variant === "large" ? "text-2xl" : "text-base",
          "font-semibold",
          urgent ? "text-ending" : "text-foreground",
          className
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      data-countdown="compact"
      data-urgent={urgent ? "true" : undefined}
      role="timer"
      aria-label={`Time remaining: ${formatRemaining(endsAt, now)}`}
      // Same hydration guard as the "boxes" variant: digits come from `now`.
      suppressHydrationWarning
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium tabular-nums",
        urgent ? "text-ending-foreground" : "text-muted-foreground",
        className
      )}
    >
      <ClockIcon className={cn("size-3.5", urgent && "text-ending")} />
      {formatRemaining(endsAt, now)}
    </span>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
