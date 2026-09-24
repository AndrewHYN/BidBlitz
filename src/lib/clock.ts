/**
 * Server-time synchronisation.
 *
 * The countdown is decoration. The authority is (server_now, starts_at,
 * ends_at) held in Postgres. Because a browser clock can be wrong — or
 * deliberately manipulated — we never subtract local time from ends_at
 * directly. Instead we measure the offset between the server timestamp and
 * this device once, then apply it to every render.
 *
 *   serverRemaining = endsAt - (localNow + offset)
 *   offset = serverTime - localSendTime      (measured round-trip, halved)
 */

export type ClockOffsetMs = number;

let offsetMs: ClockOffsetMs = 0;
let measured = false;

export function getOffsetMs(): ClockOffsetMs {
  return offsetMs;
}

export function isSynced(): boolean {
  return measured;
}

/**
 * Record an offset measurement. `rttMs` lets us discount half the round-trip
 * so network latency does not look like clock drift.
 */
export function setOffsetFromMeasurement(
  serverTimeMs: number,
  sentLocalMs: number,
  receivedLocalMs: number
): void {
  const rtt = Math.max(0, receivedLocalMs - sentLocalMs);
  // midpoint of the request window is the best guess for when serverTime was true
  const localMid = sentLocalMs + rtt / 2;
  offsetMs = serverTimeMs - localMid;
  measured = true;
}

export function resetClock(): void {
  offsetMs = 0;
  measured = false;
}

/** Current server time in ms, extrapolated from the last measurement. */
export function serverNow(localNowMs: number = Date.now()): number {
  return localNowMs + offsetMs;
}

/** Milliseconds remaining until `endsAtIso` according to the SERVER clock. */
export function msRemaining(
  endsAtIso: string,
  localNowMs: number = Date.now()
): number {
  return Date.parse(endsAtIso) - serverNow(localNowMs);
}

export type CountdownParts = {
  totalMs: number;
  expired: boolean;
  endingSoon: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

/** Threshold under which the UI shifts into an urgent "ending" treatment. */
export const ENDING_SOON_MS = 60_000;

export function countdownParts(
  endsAtIso: string,
  localNowMs: number = Date.now()
): CountdownParts {
  const totalMs = msRemaining(endsAtIso, localNowMs);
  const clamped = Math.max(0, totalMs);
  const totalSec = Math.floor(clamped / 1000);
  return {
    totalMs,
    expired: totalMs <= 0,
    endingSoon: totalMs > 0 && totalMs <= ENDING_SOON_MS,
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
  };
}

/** Human label: "2d 4h", "13m 05s", "Ending now". */
export function formatRemaining(endsAtIso: string, nowMs = Date.now()): string {
  const p = countdownParts(endsAtIso, nowMs);
  if (p.expired) return "Ended";
  if (p.days > 0) return `${p.days}d ${p.hours}h`;
  if (p.hours > 0) return `${p.hours}h ${p.minutes}m`;
  if (p.minutes > 0) return `${p.minutes}m ${String(p.seconds).padStart(2, "0")}s`;
  return `${p.seconds}s`;
}
