/**
 * A failed/unauthorised count must never be presented as a quiet queue.
 * The operational dashboard distinguishes confirmed zero from unknown.
 */
export type QueueState = "clear" | "attention" | "urgent" | "unavailable";

export function queueState(count: number | null, urgentAt = 10): QueueState {
  if (count === null || !Number.isSafeInteger(count) || count < 0) return "unavailable";
  if (count === 0) return "clear";
  return count >= urgentAt ? "urgent" : "attention";
}

export function queueLabel(count: number | null): string {
  return queueState(count) === "unavailable" ? "Unavailable" : String(count);
}

export function countFromQuery(result: { count: number | null; error: unknown } | null): number | null {
  return result && !result.error && typeof result.count === "number"
    && Number.isSafeInteger(result.count) && result.count >= 0
    ? result.count
    : null;
}
