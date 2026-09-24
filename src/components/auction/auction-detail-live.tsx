"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { BidPanel, type ServerEcho } from "@/components/auction/bid-panel";
import { Countdown } from "@/components/auction/countdown";
import { LiveStatus } from "@/components/auction/live-status";
import { Money } from "@/components/auction/money";
import { formatMoney, money } from "@/lib/money";
import type { AuctionEvent } from "@/lib/realtime/types";
import { settleIfDueAction } from "@/server/actions/auction";
import { useAuctionRealtime, useUserRealtime } from "@/hooks/use-auction-realtime";
import { cn } from "@/lib/utils";

/**
 * Wraps every mutable part of the detail page: status, countdown end time,
 * price, bid count and the bid-panel minimum.
 *
 * Three server-delivered sources can update those facts, and we always render
 * the NEWEST one — never a value computed on the client:
 *
 *   1. realtime events (auction channel)   -> serverTime inside the event
 *   2. this viewer's own committed bid     -> serverTime inside the action response
 *   3. the snapshot behind the page        -> auction.updated_at
 *
 * Nothing here derives a price: each source carries values the server already
 * decided (place_bid, settle_auction, the read model).
 */
type Snapshot = {
  serverTime: number;
  status: string;
  endsAt: string | null;
  currentBidMinor: string | null;
  bidCount: number;
  nextMinMinor: string | null;
};

export function AuctionDetailLive({
  auctionId,
  currency,
  serverUpdatedAt,
  status,
  endsAt,
  currentBidMinor,
  bidCount,
  nextMinMinor,
  startsAt,
  sellerId,
  viewerId,
  winnerId,
  winningBidMinor,
  winningBidderName,
  startingBidMinor,
  bidIncrementMinor,
  myHighestBidMinor,
  transactionStatus,
}: {
  auctionId: string;
  currency: string;
  /** Timestamp of the server snapshot this page rendered from. */
  serverUpdatedAt: string;
  status: string;
  endsAt: string | null;
  currentBidMinor: number | null;
  bidCount: number;
  /** Server-computed floor for the next bid (bigint math, done server-side). */
  nextMinMinor: string;
  startsAt: string | null;
  sellerId: string;
  viewerId: string | null;
  winnerId: string | null;
  winningBidMinor: number | null;
  winningBidderName: string | null;
  startingBidMinor: number;
  bidIncrementMinor: number;
  myHighestBidMinor: number | null;
  transactionStatus: string | null;
}) {
  const router = useRouter();

  const handleEvent = useCallback(
    (event: AuctionEvent) => {
      if (event.type === "auction.ended") router.refresh();
    },
    [router]
  );

  // The auction channel is auction-scoped, so the mirror cannot be polluted by
  // another auction's traffic. The personal channel (outbid toasts) is
  // consumed separately below via useUserRealtime.
  const { state } = useAuctionRealtime({
    auctionId,
    initial: { status, currentBidMinor, bidCount, endsAt, nextMinMinor },
    onEvent: handleEvent,
  });

  useUserRealtime(
    viewerId,
    useCallback(
      (event: AuctionEvent) => {
        if (event.type === "user.outbid" && event.auctionId === auctionId) {
          toast.info("You've been outbid", {
            description: `The bid to beat is ${formatMoney(
              money(event.nextMinMinor, event.currency)
            )}.`,
          });
        }
      },
      [auctionId]
    )
  );

  const [echo, setEcho] = useState<ServerEcho | null>(null);
  const handleEcho = useCallback((next: ServerEcho) => setEcho(next), []);

  // ---- pick the freshest server-delivered snapshot ------------------------
  const [mountTime] = useState(() => Date.parse(serverUpdatedAt));
  const propsTime = Date.parse(serverUpdatedAt);
  // `transaction.updated` is the one event without a server timestamp; it
  // changes no mirrored value, so it never wins the freshness comparison.
  const lastEvent = state.lastEvent;
  const eventTime =
    lastEvent && "serverTime" in lastEvent
      ? Date.parse(lastEvent.serverTime)
      : Number.NaN;
  const stateTime = Number.isNaN(eventTime) ? mountTime : eventTime;

  const propsSnapshot: Snapshot = {
    serverTime: propsTime,
    status,
    endsAt,
    currentBidMinor: currentBidMinor === null ? null : String(currentBidMinor),
    bidCount,
    nextMinMinor,
  };
  const eventSnapshot: Snapshot = {
    serverTime: stateTime,
    status: state.status,
    endsAt: state.endsAt,
    currentBidMinor: state.currentBidMinor,
    bidCount: state.bidCount,
    nextMinMinor: state.nextMinMinor,
  };

  let live: Snapshot = stateTime >= propsTime ? eventSnapshot : propsSnapshot;

  const echoTime = echo ? Date.parse(echo.serverTime) : Number.NaN;
  if (echo && !Number.isNaN(echoTime) && echoTime >= live.serverTime) {
    // A committed bid never changes the auction status, so the current status
    // stands and the rest of the facts come from the action's response.
    live = {
      serverTime: echoTime,
      status: live.status,
      endsAt: echo.endsAt,
      currentBidMinor: echo.currentBidMinor,
      bidCount: echo.bidCount,
      nextMinMinor: echo.nextMinMinor,
    };
  }

  // ---- settle exactly once when a LIVE countdown expires -------------------
  const settleAttempted = useRef(false);
  const handleExpire = useCallback(() => {
    if (settleAttempted.current) return;
    if (live.status !== "LIVE") return;
    settleAttempted.current = true;
    // The server decides whether settlement was due; either way we refresh so
    // the winner / fee result appears without a manual reload.
    void settleIfDueAction(auctionId).finally(() => router.refresh());
  }, [live.status, auctionId, router]);

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div data-testid="auction-status">
          <LiveStatus status={live.status} endsAt={live.endsAt} />
        </div>
        <div data-testid="countdown">
          <Countdown
            endsAt={live.endsAt}
            status={live.status}
            variant="boxes"
            onExpire={handleExpire}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div data-testid="current-bid">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {live.currentBidMinor === null ? "Starting bid" : "Current bid"}
          </p>
          <p
            key={live.currentBidMinor ?? "starting"}
            className={cn(
              "text-3xl font-semibold tracking-tight",
              state.revision > 0 && "animate-flash"
            )}
          >
            <Money
              minor={live.currentBidMinor ?? startingBidMinor}
              currency={currency}
              compact={false}
            />
          </p>
        </div>

        <p data-testid="bid-count" className="text-sm text-muted-foreground">
          <span data-numeric>{live.bidCount}</span>{" "}
          {live.bidCount === 1 ? "bid" : "bids"}
        </p>
      </div>

      <BidPanel
        auctionId={auctionId}
        currency={currency}
        status={live.status}
        endsAt={live.endsAt}
        currentBidMinor={live.currentBidMinor}
        nextMinMinor={live.nextMinMinor}
        startsAt={startsAt}
        sellerId={sellerId}
        viewerId={viewerId}
        winnerId={winnerId}
        winningBidMinor={winningBidMinor}
        winningBidderName={winningBidderName}
        startingBidMinor={startingBidMinor}
        bidIncrementMinor={bidIncrementMinor}
        myHighestBidMinor={myHighestBidMinor}
        transactionStatus={transactionStatus}
        onServerEcho={handleEcho}
      />
    </div>
  );
}
