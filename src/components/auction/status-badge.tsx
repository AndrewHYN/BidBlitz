import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { conditionLabels } from "@/lib/validation";

/**
 * One colour per auction state, everywhere in the product. The badge is the
 * fast read; the countdown is the precise one.
 */

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
  {
    variants: {
      tone: {
        live: "bg-live text-live-foreground ring-transparent",
        ending: "bg-ending text-ending-foreground ring-transparent",
        scheduled: "bg-secondary text-secondary-foreground ring-border",
        draft: "bg-muted text-muted-foreground ring-border",
        ended: "bg-muted text-muted-foreground ring-border",
        sold: "bg-won text-won-foreground ring-transparent",
        unsold: "bg-muted text-muted-foreground ring-border",
        cancelled: "bg-destructive/12 text-destructive ring-destructive/25",
        featured: "bg-primary/12 text-primary ring-primary/25",
        neutral: "bg-secondary text-secondary-foreground ring-border",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "LIVE":
      return "live";
    case "SCHEDULED":
      return "scheduled";
    case "DRAFT":
      return "draft";
    case "ENDED":
      return "ended";
    case "SOLD":
      return "sold";
    case "UNSOLD":
      return "unsold";
    case "CANCELLED":
      return "cancelled";
    default:
      return "neutral";
  }
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  LIVE: "Live",
  ENDED: "Ended",
  SOLD: "Sold",
  UNSOLD: "No bids",
  CANCELLED: "Cancelled",
};

const TRANSACTION_LABELS: Record<string, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  SETTLED: "Settled",
  REFUNDED: "Refunded",
  FAILED: "Failed",
};

export function StatusBadge({
  status,
  endingSoon = false,
  className,
}: {
  status: string;
  /** LIVE auctions inside their final window render amber, not green. */
  endingSoon?: boolean;
  className?: string;
}) {
  const tone =
    status === "LIVE" && endingSoon ? "ending" : statusTone(status);
  const label =
    STATUS_LABELS[status] ?? TRANSACTION_LABELS[status] ?? status;

  return (
    <span data-status={status} className={cn(badgeVariants({ tone }), className)}>
      {(status === "LIVE" || endingSoon) && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full bg-current",
            status === "LIVE" && "animate-pulse-slow"
          )}
        />
      )}
      {endingSoon && status === "LIVE" ? "Ending soon" : label}
    </span>
  );
}

export function TransactionBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone: BadgeTone =
    status === "PAID" || status === "SETTLED"
      ? "sold"
      : status === "FAILED"
        ? "cancelled"
        : status === "AWAITING_PAYMENT"
          ? "ending"
          : "neutral";

  return (
    <span data-status={status} className={cn(badgeVariants({ tone }), className)}>
      {TRANSACTION_LABELS[status] ?? status}
    </span>
  );
}

export function ConditionBadge({ condition, className }: { condition: string; className?: string }) {
  return (
    <span className={cn(badgeVariants({ tone: "neutral" }), className)}>
      {conditionLabels[condition as keyof typeof conditionLabels] ?? condition}
    </span>
  );
}

export { badgeVariants };
