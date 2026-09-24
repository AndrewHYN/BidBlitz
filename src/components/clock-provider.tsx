"use client";

/**
 * One clock for the whole app.
 *
 * A single provider measures the client/server offset once (refreshing it
 * occasionally) and ticks once per second, so N countdowns on a page share one
 * interval and one source of truth instead of each trusting `Date.now()`.
 *
 * `now` is SERVER time in ms. The initial value is handed in by the Server
 * Component that renders this provider, so the very first paint — including
 * the server-rendered HTML — is already on server time.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { isSynced, serverNow, setOffsetFromMeasurement } from "@/lib/clock";

type ClockValue = {
  /** Server time in milliseconds since epoch. */
  now: number;
  /** True once at least one offset measurement has succeeded. */
  synced: boolean;
  /** Force a fresh measurement (used when a realtime event carries serverTime). */
  resync: () => void;
};

const ClockContext = createContext<ClockValue | null>(null);

const RESYNC_INTERVAL_MS = 5 * 60_000;

export function ClockProvider({
  serverTimeMs,
  children,
}: {
  serverTimeMs: number;
  children: React.ReactNode;
}) {
  const [now, setNow] = useState<number>(serverTimeMs);
  const [synced, setSynced] = useState(false);
  const [nonce, setNonce] = useState(0);

  const resync = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function measure() {
      const sent = Date.now();
      try {
        const res = await fetch("/api/time", { cache: "no-store" });
        const received = Date.now();
        if (!res.ok) return;
        const body = (await res.json()) as { now?: string };
        const serverMs = Date.parse(body.now ?? "");
        if (!Number.isFinite(serverMs)) return;
        setOffsetFromMeasurement(serverMs, sent, received);
        if (!cancelled) {
          setSynced(isSynced());
          setNow(serverNow());
        }
      } catch {
        // Offline or blocked: fall back to the local clock and keep ticking.
        if (!cancelled) setSynced(isSynced());
      }
    }

    void measure();

    const resyncTimer = window.setInterval(measure, RESYNC_INTERVAL_MS);
    const tickTimer = window.setInterval(() => setNow(serverNow()), 1000);

    return () => {
      cancelled = true;
      window.clearInterval(resyncTimer);
      window.clearInterval(tickTimer);
    };
  }, [nonce]);

  const value = useMemo<ClockValue>(
    () => ({ now, synced, resync }),
    [now, synced, resync]
  );

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}

export function useClock(): ClockValue {
  const ctx = useContext(ClockContext);
  if (!ctx) {
    throw new Error("useClock must be used inside <ClockProvider>");
  }
  return ctx;
}

/** Current server time in ms. Re-renders once per second. */
export function useNow(): number {
  return useClock().now;
}
