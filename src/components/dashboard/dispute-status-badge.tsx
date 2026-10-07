import { Badge } from "@/components/ui/badge";
import { DISPUTE_STATUS_LABELS } from "@/lib/disputes";
import type { DisputeStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export function DisputeStatusBadge({
  status,
  className,
}: {
  status: DisputeStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide",
        status === "RESOLVED" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "UNDER_REVIEW" && "border-primary/25 bg-primary/10 text-primary",
        (status === "WAITING_FOR_BUYER" || status === "WAITING_FOR_SELLER") &&
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        status === "OPEN" && "border-destructive/25 bg-destructive/10 text-destructive",
        className
      )}
    >
      {DISPUTE_STATUS_LABELS[status]}
    </Badge>
  );
}
