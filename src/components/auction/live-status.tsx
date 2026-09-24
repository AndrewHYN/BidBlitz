import { StatusBadge } from "@/components/auction/status-badge";
import { isClosed, CARD_ENDING_SOON_MS } from "@/lib/auction-status";
import { useNow } from "@/components/clock-provider";

/**
 * Client shell around the (server-safe) StatusBadge so the card itself can
 * stay a Server Component. Only this leaf re-renders each second.
 */
export function LiveStatus({
  status,
  endsAt,
  className,
}: {
  status: string;
  endsAt: string | null | undefined;
  className?: string;
}) {
  const now = useNow();

  let endingSoon = false;
  if (status === "LIVE" && endsAt && !isClosed(status)) {
    const remaining = Date.parse(endsAt) - now;
    endingSoon = remaining > 0 && remaining <= CARD_ENDING_SOON_MS;
  }

  return <StatusBadge status={status} endingSoon={endingSoon} className={className} />;
}
