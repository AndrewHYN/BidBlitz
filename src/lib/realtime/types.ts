/**
 * Realtime contract.
 *
 * The auction domain talks to THIS interface and nothing else, so the
 * transport can be swapped (Broadcast -> Postgres Changes -> websockets ->
 * SSE) without touching a single auction component.
 *
 * Hard rule: realtime is a notification channel, never the authority.
 * The only correct order is
 *
 *   DB transaction commits -> event emitted -> clients update
 *
 * A client may never publish a result it computed itself.
 */

export type RealtimeStatus = "connecting" | "online" | "offline";

export type AuctionEvent =
  | {
      type: "bid.accepted";
      auctionId: string;
      amountMinor: string;        // bigint arrives as a string over JSON
      bidCount: number;
      endsAt: string;
      extended: boolean;
      bidderId: string | null;
      serverTime: string;
      /** present when this recipient was the one outbid */
      outbid?: boolean;
      nextMinMinor: string;
    }
  | {
      type: "auction.extended";
      auctionId: string;
      endsAt: string;
      extensionSeconds: number;
      serverTime: string;
    }
  | {
      type: "auction.updated";
      auctionId: string;
      status: string;
      currentBidMinor: string | null;
      bidCount: number;
      endsAt: string | null;
      serverTime: string;
    }
  | {
      type: "auction.ended";
      auctionId: string;
      status: "SOLD" | "UNSOLD" | "CANCELLED";
      winnerId: string | null;
      winningBidMinor: string | null;
      serverTime: string;
    }
  | {
      type: "user.outbid";
      auctionId: string;
      currentBidMinor: string;
      yourLastBidMinor: string | null;
      nextMinMinor: string;
      currency: string;
      serverTime: string;
    }
  | {
      type: "transaction.updated";
      auctionId: string;
      transactionId: string;
      status: string;
    };

export type Unsubscribe = () => void;

export interface RealtimeAdapter {
  /** Human-readable transport name, surfaced in dev diagnostics only. */
  readonly transport: string;

  /** Subscribe to one auction's public channel. */
  subscribeAuction(
    auctionId: string,
    handler: (event: AuctionEvent) => void
  ): Unsubscribe;

  /** Subscribe to events addressed to a specific user (outbid, won, sold). */
  subscribeUser(
    userId: string,
    handler: (event: AuctionEvent) => void
  ): Unsubscribe;

  /** Server-side emit. Called ONLY after a database transaction commits. */
  publish(auctionId: string, event: AuctionEvent): Promise<void>;

  /** Server-side emit on a per-user channel. */
  publishToUser(
    userId: string,
    auctionId: string,
    event: AuctionEvent
  ): Promise<void>;

  status(): RealtimeStatus;
}
