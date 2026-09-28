"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createBrowserRealtime } from "@/lib/realtime/supabase";
import type { AuctionEvent, RealtimeStatus } from "@/lib/realtime/types";

/**
 * Realtime is a NOTIFICATION channel. Every hook here updates a local mirror
 * of server-provided facts; nothing is ever derived or optimistically invented
 * on the client. The authoritative values arrive inside the event payload,
 * which the server emits only after the transaction committed.
 */

export type LiveState = {
  status: string;
  currentBidMinor: string | null;
  bidCount: number;
  endsAt: string | null;
  nextMinMinor: string | null;
  connection: RealtimeStatus;
  /** last event, for consumers that branch on type */
  lastEvent: AuctionEvent | null;
  /** increments on every event — useful as a `key` to re-trigger animations */
  revision: number;
  /**
   * The newest server timestamp this hook is willing to believe. Advances only
   * when a plausible event arrives, and bounds the next one. See
   * MAX_EVENT_FUTURE_SKEW_MS.
   */
  serverTimeFloor: number;
};

/**
 * How far ahead of the newest timestamp already trusted an event's own
 * `serverTime` may claim to be.
 *
 * The realtime channels are PUBLIC (see src/lib/realtime/supabase.ts), so an
 * event payload is attacker-controlled input, and these values end up driving
 * the `status` handed to the bid panel. Two shapes of forgery previously won
 * the "newest source" comparison and overwrote the server-rendered facts in
 * every other viewer's browser:
 *
 *   - an event with no `serverTime` at all, which fell back to the client mount
 *     time and therefore always beat the server snapshot;
 *   - an event claiming a timestamp years in the future.
 *
 * Either one could make a live auction render as ended, which removes the bid
 * form for every viewer until they reload - a denial of service against the
 * marketplace, needing no account, only the publishable key.
 *
 * This hardens the DISPLAY path and is not an authorization boundary. The
 * server alone still decides whether a bid is valid, so a forged mirror cannot
 * make a bid succeed, move money, or change a transaction. Ninety seconds is far
 * more than a genuine event ever needs (they publish immediately after COMMIT)
 * while still stopping a bystander from silently rewriting the page.
 */
export const MAX_EVENT_FUTURE_SKEW_MS = 90_000;

/**
 * The trust decision, as a pure function so it can be tested directly rather
 * than only through a browser.
 *
 * An event is admitted to the mirror only when it carries a timestamp the
 * server could plausibly have produced, relative to the newest timestamp the
 * server has already confirmed. Everything else is dropped without touching a
 * mirrored value.
 */
export function admitEventTime(
  event: unknown,
  floor: number
): { admitted: boolean; stamped: number } {
  const stamped =
    event && typeof event === "object" && "serverTime" in event
      ? Date.parse(String((event as { serverTime?: unknown }).serverTime ?? ""))
      : Number.NaN;

  const admitted =
    !Number.isNaN(stamped) && stamped <= floor + MAX_EVENT_FUTURE_SKEW_MS;
  return { admitted, stamped };
}

export function useAuctionRealtime(options: {
  auctionId: string;
  initial: {
    status: string;
    currentBidMinor: number | string | null;
    bidCount: number;
    endsAt: string | null;
    nextMinMinor?: number | string | null;
  };
  /**
   * The server-rendered snapshot's own timestamp, as epoch ms. It seeds the
   * trust bound so the very first event is checked against something the server
   * actually said rather than against the client's own clock.
   */
  serverTimeFloor?: number;
  viewerId?: string | null;
  onEvent?: (event: AuctionEvent) => void;
}): { state: LiveState; connection: RealtimeStatus } {
  const { auctionId, initial, serverTimeFloor = 0, viewerId = null, onEvent } = options;

  const [state, setState] = useState<LiveState>(() => ({
    status: initial.status,
    currentBidMinor:
      initial.currentBidMinor === null || initial.currentBidMinor === undefined
        ? null
        : String(initial.currentBidMinor),
    bidCount: initial.bidCount,
    endsAt: initial.endsAt,
    nextMinMinor:
      initial.nextMinMinor === undefined || initial.nextMinMinor === null
        ? null
        : String(initial.nextMinMinor),
    connection: "connecting",
    lastEvent: null,
    revision: 0,
    serverTimeFloor,
  }));

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const apply = useCallback((event: AuctionEvent) => {
    setState((prev) => {
      // Refuse an implausible event BEFORE its values can enter the mirror, so
      // nothing forged is ever rendered. The revision still advances: the page
      // simply keeps the facts the server last gave it.
      const { admitted, stamped } = admitEventTime(event, prev.serverTimeFloor);
      if (!admitted) {
        return { ...prev, revision: prev.revision + 1 };
      }

      const next: LiveState = {
        ...prev,
        lastEvent: event,
        revision: prev.revision + 1,
        // Advance the bound so a long-lived page keeps accepting genuine events
        // instead of pinning to the moment it was rendered.
        serverTimeFloor: Math.max(prev.serverTimeFloor, stamped),
      };

      switch (event.type) {
        case "bid.accepted":
          next.currentBidMinor = event.amountMinor;
          next.bidCount = event.bidCount;
          next.endsAt = event.endsAt;
          next.nextMinMinor = event.nextMinMinor;
          break;
        case "auction.extended":
          next.endsAt = event.endsAt;
          break;
        case "auction.updated":
          next.status = event.status;
          next.currentBidMinor = event.currentBidMinor;
          next.bidCount = event.bidCount;
          next.endsAt = event.endsAt;
          break;
        case "auction.ended":
          next.status = event.status;
          if (event.winningBidMinor !== null) next.currentBidMinor = event.winningBidMinor;
          break;
        case "user.outbid":
          next.currentBidMinor = event.currentBidMinor;
          next.nextMinMinor = event.nextMinMinor;
          break;
        default:
          break;
      }
      return next;
    });
    onEventRef.current?.(event);
  }, []);

  useEffect(() => {
    const client = createClient();
    const adapter = createBrowserRealtime(client);

    const unsubAuction = adapter.subscribeAuction(auctionId, apply);
    const unsubUser = viewerId ? adapter.subscribeUser(viewerId, apply) : null;

    // Poll rather than proxy the socket state: a dropped connection recovers
    // without remounting the tree (which would throw away the live mirror).
    // The setState lives in the interval callback — a subscription to an
    // external system — rather than in the effect body.
    const poll = window.setInterval(() => {
      const s = adapter.status();
      setState((prev) => (prev.connection === s ? prev : { ...prev, connection: s }));
    }, 1000);

    return () => {
      window.clearInterval(poll);
      unsubAuction();
      unsubUser?.();
    };
  }, [auctionId, viewerId, apply]);

  return { state, connection: state.connection };
}

/** Subscribes only to a user's personal channel (outbid / won / sold). */
export function useUserRealtime(
  userId: string | null | undefined,
  onEvent: (event: AuctionEvent) => void
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(() =>
    userId ? "connecting" : "offline"
  );
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!userId) return;
    const client = createClient();
    const adapter = createBrowserRealtime(client);
    const unsub = adapter.subscribeUser(userId, (e) => handlerRef.current(e));

    const poll = window.setInterval(() => setStatus(adapter.status()), 1500);
    return () => {
      window.clearInterval(poll);
      unsub();
    };
  }, [userId]);

  return status;
}
