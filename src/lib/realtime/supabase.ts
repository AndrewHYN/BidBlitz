import type { RealtimeAdapter, AuctionEvent, RealtimeStatus, Unsubscribe } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Realtime Broadcast implementation.
 *
 * Chosen over Postgres Changes for the hot path because Broadcast is a
 * low-latency fan-out that does not wake the database, and private channels
 * are authorised by RLS. Postgres Changes stays available as the
 * reconnect/reconciliation fallback (the tables are in the
 * `supabase_realtime` publication) but is not the primary signal.
 */

const auctionChannel = (id: string) => `auction:${id}`;
const userChannel = (id: string) => `user:${id}`;

type Handler = (event: AuctionEvent) => void;

function toAdapter(
  client: SupabaseClient,
  transport: string,
  canPublish: boolean
): RealtimeAdapter {
  const listeners = new Map<string, Set<Handler>>();
  let status: RealtimeStatus = "connecting";

  function dispatch(channelName: string, payload: unknown) {
    const set = listeners.get(channelName);
    if (!set) return;
    // payload arrives as { type: "bid.accepted", ... } under event or payload
    const body = (payload as { type?: string; event?: unknown }) ?? {};
    const event = (body.type ? body : (payload as AuctionEvent)) as AuctionEvent;
    if (!event || typeof event !== "object" || !("type" in event)) return;
    set.forEach((fn) => {
      try {
        fn(event);
      } catch (err) {
        // one broken subscriber must never break the channel for others
        console.error("[realtime] subscriber threw", err);
      }
    });
  }

  function attach(channelName: string): ReturnType<SupabaseClient["channel"]> {
    const channel = client
      .channel(channelName, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "*" }, ({ payload }) => dispatch(channelName, payload));

    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") status = "online";
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") status = "offline";
      else if (state === "CLOSED") status = listeners.size ? "offline" : status;
    });

    return channel;
  }

  const channels = new Map<string, ReturnType<typeof attach>>();

  function subscribe(channelName: string, handler: Handler): Unsubscribe {
    let set = listeners.get(channelName);
    if (!set) {
      set = new Set();
      listeners.set(channelName, set);
      channels.set(channelName, attach(channelName));
    }
    set.add(handler);

    return () => {
      const s = listeners.get(channelName);
      if (!s) return;
      s.delete(handler);
      // reference-count: tear the channel down only when nobody is listening
      if (s.size === 0) {
        listeners.delete(channelName);
        const ch = channels.get(channelName);
        if (ch) {
          channels.delete(channelName);
          void client.removeChannel(ch);
        }
      }
    };
  }

  return {
    transport,
    status: () => status,

    subscribeAuction(auctionId, handler) {
      return subscribe(auctionChannel(auctionId), handler);
    },

    subscribeUser(userId, handler) {
      return subscribe(userChannel(userId), handler);
    },

    async publish(auctionId, event) {
      if (!canPublish) {
        throw new Error("publish() requires a client with broadcast privileges");
      }
      const name = auctionChannel(auctionId);
      const ch = channels.get(name) ?? attach(name);
      channels.set(name, ch);
      // wait for the send to be acknowledged so callers can order it after COMMIT
      await new Promise<void>((resolve) => {
        ch.send({ type: "broadcast", event: "*", payload: event }).then(() => resolve());
      });
    },

    async publishToUser(userId, auctionId, event) {
      if (!canPublish) {
        throw new Error("publish() requires a client with broadcast privileges");
      }
      const name = userChannel(userId);
      const ch = channels.get(name) ?? attach(name);
      channels.set(name, ch);
      await new Promise<void>((resolve) => {
        ch.send({ type: "broadcast", event: "*", payload: { ...event, auctionId } })
          .then(() => resolve());
      });
    },
  };
}

/** Browser adapter: publishable key, RLS-scoped, no privileged credentials. */
export function createBrowserRealtime(client: SupabaseClient): RealtimeAdapter {
  return toAdapter(client, "supabase-broadcast", false);
}

/**
 * Server adapter: allowed to emit. Used by Server Actions strictly after the
 * database transaction has committed.
 */
export function createServerRealtime(client: SupabaseClient): RealtimeAdapter {
  return toAdapter(client, "supabase-broadcast", true);
}

/**
 * No-op adapter for environments without realtime (SSG, tests without network).
 * Keeps every consumer honest about the fact that nothing will arrive.
 */
export function createNullRealtime(): RealtimeAdapter {
  const noop = () => () => {};
  return {
    transport: "null",
    status: () => "offline",
    subscribeAuction: noop,
    subscribeUser: noop,
    publish: async () => {},
    publishToUser: async () => {},
  };
}
