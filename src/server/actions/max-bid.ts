"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerRealtime } from "@/lib/realtime/supabase";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { placeBidSchema } from "@/lib/validation";
import { normalizeEngineError } from "@/server/errors";
import { BID_LIMIT, rateLimit } from "@/server/rate-limit";

type Result = { ok: true; transactionId?: string } | { ok: false; message: string };
const submitSchema = placeBidSchema.extend({ bindingBidConfirmed: z.literal(true) }).strict();
const decisionSchema = z.object({ offerId: z.string().uuid(), accept: z.boolean(), confirmed: z.literal(true) }).strict();

function refusal(message: string, hint?: string): Result {
  if (message.includes("offer_outbid")) return { ok: false, message: "This Max Bid has been outbid. You can only accept the current highest bid." };
  if (message.includes("offer_unavailable")) return { ok: false, message: "This offer is no longer available to decide." };
  if (message.includes("early_settlement_failed")) return { ok: false, message: "The sale could not be confirmed. Nothing was closed or charged." };
  const rejection = normalizeEngineError({ message, hint });
  return { ok: false, message: rejection.nextMinMinor !== undefined ? `The minimum bid is $${(rejection.nextMinMinor / 100n).toString()}.${(rejection.nextMinMinor % 100n).toString().padStart(2, "0")}.` : rejection.message };
}

function refresh(auctionId?: string) {
  if (auctionId) revalidatePath(`/auction/${auctionId}`);
  revalidatePath("/", "layout");
}

export async function submitMaxBidAction(input: unknown): Promise<Result> {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid amount and confirm that this is a binding bid." };
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to place a Max Bid." };
  if (!rateLimit(`bid:${user.id}`, BID_LIMIT.limit, BID_LIMIT.windowMs).allowed) return { ok: false, message: "Wait a few seconds before bidding again." };
  const { data, error } = await db.rpc("submit_max_bid", {
    p_auction_id: parsed.data.auctionId, p_amount_minor: Number(parsed.data.amountMinor), p_request_id: parsed.data.requestId,
  });
  if (error) return refusal(error.message, error.hint);
  if (!data?.ok) return refusal(data?.error ?? "unknown");
  if (!data.duplicate) {
    try {
      const rt = createServerRealtime(createAdminClient());
      const serverTime = data.server_time ?? new Date().toISOString();
      await rt.publish(parsed.data.auctionId, {
        type: "bid.accepted", auctionId: parsed.data.auctionId, amountMinor: String(data.amount_minor),
        bidCount: data.bid_count, endsAt: data.ends_at, extended: Boolean(data.extended), bidderId: user.id,
        serverTime, nextMinMinor: String(data.next_min_minor),
      });
      if (data.outbid_user_id && data.outbid_user_id !== user.id) {
        await rt.publishToUser(data.outbid_user_id, parsed.data.auctionId, {
          type: "user.outbid", auctionId: parsed.data.auctionId, currentBidMinor: String(data.current_bid_minor),
          yourLastBidMinor: null, nextMinMinor: String(data.next_min_minor), currency: "USD", serverTime,
        });
      }
    } catch { /* Broadcast failure cannot undo a committed binding bid. */ }
  }
  refresh(parsed.data.auctionId);
  return { ok: true };
}

export async function decideMaxBidAction(input: unknown): Promise<Result> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Confirm the offer decision first." };
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { ok: false, message: "Sign in to manage your offers." };
  if (!rateLimit(`max-bid-decision:${user.id}`, 20, 60_000).allowed) return { ok: false, message: "Wait a moment before trying again." };
  const { data, error } = await db.rpc("decide_max_bid", { p_offer_id: parsed.data.offerId, p_accept: parsed.data.accept });
  if (error) return refusal(error.message, error.hint);
  if (!data?.ok) return refusal(data?.error ?? "unknown");
  if (parsed.data.accept && data.status === "SOLD" && data.auction_id) {
    try {
      await createServerRealtime(createAdminClient()).publish(data.auction_id, {
        type: "auction.ended", auctionId: data.auction_id, status: "SOLD", winnerId: data.winner_id,
        winningBidMinor: String(data.winning_bid_minor), serverTime: new Date().toISOString(),
      });
    } catch { /* Sale remains committed even if the notification channel is down. */ }
  }
  refresh(data.auction_id);
  return { ok: true, transactionId: data.transaction_id ?? undefined };
}
