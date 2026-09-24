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
    const cells: Array<[number, string]> = parts
      ? [
          [parts.days, "d"],
          [parts.hours, "h"],
          [parts.minutes, "m"],
          [parts.seconds, "s"],
        ]
      : [];

    const visible = cells.filter(([v], i) => v > 0 || i >= 2);

    return (
      <div
        data-countdown="boxes"
        data-urgent={urgent ? "true" : undefined}
        className={cn("flex items-center gap-1.5", className)}
        role="timer"
        aria-label={`Time remaining: ${formatRemaining(endsAt, now)}`}
      >
        {visible.map(([value, unit]) => (
          <div
            key={unit}
            className={cn(
              "grid min-w-12 place-items-center rounded-lg border bg-card px-2 py-1.5",
              urgent
                ? "border-ending/60 bg-ending/10 text-ending-foreground"
                : "text-foreground"
            )}
          >
            <span
              data-numeric
              className={cn(
                "font-semibold tabular-nums",
                variant === "large" ? "text-2xl" : "text-lg"
              )}
            >
              {String(value).padStart(2, "0")}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {unit}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <span
      data-countdown="compact"
      data-urgent={urgent ? "true" : undefined}
      role="timer"
      aria-label={`Time remaining: ${formatRemaining(endsAt, now)}`}
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
