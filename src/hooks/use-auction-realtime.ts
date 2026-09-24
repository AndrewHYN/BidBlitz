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
};

export function useAuctionRealtime(options: {
  auctionId: string;
  initial: {
    status: string;
    currentBidMinor: number | string | null;
    bidCount: number;
    endsAt: string | null;
    nextMinMinor?: number | string | null;
  };
  viewerId?: string | null;
  onEvent?: (event: AuctionEvent) => void;
}): { state: LiveState; connection: RealtimeStatus } {
  const { auctionId, initial, viewerId = null, onEvent } = options;

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
  }));

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const apply = useCallback((event: AuctionEvent) => {
    setState((prev) => {
      const next: LiveState = { ...prev, lastEvent: event, revision: prev.revision + 1 };

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
