"use server";

/**
 * Bid submission — the single most important server action.
 *
 * Sequence (never reversed):
 *   1. validate the request with Zod
 *   2. authenticate
 *   3. call place_bid() in Postgres  -> locks, rules, idempotency, anti-snipe
 *   4. ONLY AFTER it returns success, emit realtime
 *
 * The browser never decides a price, a winner or an end time. If the engine
 * rejects the bid, we return the specific reason and nothing is broadcast.
 */

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerRealtime } from "@/lib/realtime/supabase";
import { placeBidSchema } from "@/lib/validation";
import { formatMoney, money } from "@/lib/money";
import { normalizeEngineError, type BidRejection } from "@/server/errors";
import { BID_LIMIT, rateLimit } from "@/server/rate-limit";

export type PlaceBidResult =
  | {
      ok: true;
      duplicate: boolean;
      bidId: string;
      amountMinor: string;
      currentBidMinor: string;
      bidCount: number;
      endsAt: string;
      extended: boolean;
      nextMinMinor: string;
      serverTime: string;
      outbidUserId: string | null;
    }
  | { ok: false; rejection: BidRejection };

export async function placeBidAction(input: {
  auctionId: string;
  amountMinor: string;
  /** idempotency key: one per submission attempt, reused on retry */
  requestId?: string;
}): Promise<PlaceBidResult> {
  const parsed = placeBidSchema.safeParse({
    auctionId: input.auctionId,
    amountMinor: input.amountMinor,
    requestId: input.requestId ?? randomUUID(),
  });

  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        code: "invalid_amount",
        message: parsed.error.issues[0]?.message ?? "Enter a valid bid amount.",
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      rejection: { code: "not_authenticated", message: "Sign in to bid." },
    };
  }

  // Per-account submission budget (in-memory, see rate-limit.ts): every attempt
  // counts, because even rejected ones are work. 30 bids in 10s is far beyond
  // what a person does and far below what a hot auction legitimately needs from
  // one bidder; the idempotent retry path stays inside it.
  const budget = rateLimit(`bid:${user.id}`, BID_LIMIT.limit, BID_LIMIT.windowMs);
  if (!budget.allowed) {
    return {
      ok: false,
      rejection: {
        code: "rate_limited",
        message: "You're bidding very quickly. Wait a few seconds and try again.",
      },
    };
  }

  const { data, error } = await supabase.rpc("place_bid", {
    p_auction_id: parsed.data.auctionId,
    p_amount_minor: Number(parsed.data.amountMinor),
    p_request_id: parsed.data.requestId,
  });

  if (error) {
    return {
      ok: false,
      rejection: normalizeEngineError({
        message: error.message,
        hint: (error as { hint?: string }).hint,
      }),
    };
  }

  const payload = data as {
    ok: boolean;
    duplicate: boolean;
    bid_id: string;
    amount_minor: number | string;
    current_bid_minor: number | string;
    bid_count: number;
    ends_at: string;
    extended: boolean;
    extension_seconds?: number;
    next_min_minor: number | string;
    server_time?: string;
    outbid_user_id: string | null;
    status?: string;
  };

  // The idempotent-replay branch returns a smaller object; normalise so the
  // caller always sees a complete, well-typed result.
  const serverTime = payload.server_time ?? new Date().toISOString();

  if (!payload?.ok) {
    return {
      ok: false,
      rejection: normalizeEngineError(payload),
    };
  }

  const currentBidMinor = String(payload.current_bid_minor);
  const endsAt = payload.ends_at;

  // ---- the transaction has committed; now it is safe to notify ------------
  // Nothing below this line may influence the result the user is shown.
  try {
    const admin = createAdminClient();
    const rt = createServerRealtime(admin);

    const bidEvent = {
      type: "bid.accepted" as const,
      auctionId: parsed.data.auctionId,
      amountMinor: String(payload.amount_minor),
      bidCount: payload.bid_count,
      endsAt,
      extended: Boolean(payload.extended),
      bidderId: user.id,
      serverTime,
      nextMinMinor: String(payload.next_min_minor),
    };

    await rt.publish(parsed.data.auctionId, bidEvent);

    if (payload.outbid_user_id && payload.outbid_user_id !== user.id) {
      await rt.publishToUser(payload.outbid_user_id, parsed.data.auctionId, {
        type: "user.outbid",
        auctionId: parsed.data.auctionId,
        currentBidMinor,
        yourLastBidMinor: null,
        nextMinMinor: String(payload.next_min_minor),
        currency: "USD",
        serverTime,
      });
      // The outbid email is optional mail (silenceable in settings); the
      // realtime event above is the urgent channel. Keyed on the bid so a
      // retried submission cannot mail twice.
      const { notifyUser } = await import("@/server/email/notify");
      const { emailKey } = await import("@/server/email/sender");
      const { data: outbidAuction } = await supabase
        .from("auctions")
        .select("id, title")
        .eq("id", parsed.data.auctionId)
        .maybeSingle();
      const outbidTitle =
        (outbidAuction as { title?: string } | null)?.title ?? "An auction you bid on";
      await notifyUser(
        payload.outbid_user_id,
        "outbid",
        {
          title: outbidTitle,
          auctionId: parsed.data.auctionId,
          amount: formatMoney(money(currentBidMinor)),
        },
        emailKey("outbid", "bid", payload.bid_id)
      ).catch(() => undefined);
    }

    if (payload.extended) {
      await rt.publish(parsed.data.auctionId, {
        type: "auction.extended",
        auctionId: parsed.data.auctionId,
        endsAt,
        extensionSeconds: payload.extension_seconds ?? 0,
        serverTime,
      });
    }
  } catch (err) {
    // Realtime is best-effort: the bid is already durable, so we log and move
    // on rather than telling the user something failed when it did not.
    console.error("[realtime] post-bid publish failed", err);
  }

  revalidatePath(`/auction/${parsed.data.auctionId}`);
  revalidatePath("/");

  return {
    ok: true,
    duplicate: Boolean(payload.duplicate),
    bidId: payload.bid_id,
    amountMinor: String(payload.amount_minor),
    currentBidMinor,
    bidCount: payload.bid_count,
    endsAt,
    extended: Boolean(payload.extended),
    nextMinMinor: String(payload.next_min_minor),
    serverTime,
    outbidUserId: payload.outbid_user_id,
  };
}
