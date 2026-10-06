"use server";

/**
 * Auction lifecycle actions: draft -> publish -> live -> settled/cancelled.
 * State transitions happen ONLY inside PLPGSQL; these actions authorise and
 * relay.
 */

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerRealtime } from "@/lib/realtime/supabase";
import {
  CANCELLATION_REASONS,
  createAuctionSchema,
  fulfilmentMethodSchema,
  publishAuctionSchema,
} from "@/lib/validation";
import { normalizeEngineError, type BidRejection } from "@/server/errors";
import { AUCTION_CREATE_LIMIT, rateLimit } from "@/server/rate-limit";
import { notifySeller } from "@/server/email/notify";
import { emailKey } from "@/server/email/sender";

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; rejection: BidRejection; fieldErrors?: Record<string, string[]> };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function createAuctionAction(input: unknown): Promise<
  ActionResult<{ auctionId: string }>
> {
  const parsed = createAuctionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      rejection: { code: "invalid_amount", message: "Please fix the highlighted fields." },
      fieldErrors,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return {
      ok: false,
      rejection: { code: "not_authenticated", message: "Sign in to sell." },
    };
  }

  // A suspended account is told so at the door, not after filling the form:
  // the is_banned triggers would refuse the publish anyway, but "created,
  // now it can't be published" is a worse answer than an honest refusal.
  // The check reads the caller's own row, which RLS permits.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_banned")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.is_banned) {
    return {
      ok: false,
      rejection: {
        code: "account_banned",
        message:
          "Your account can't bid or list right now. If you think that's a mistake, get in touch.",
      },
    };
  }

  // Per-account listing budget (in-memory, see rate-limit.ts): draft creation
  // is a write a human does a handful of times, never ten times a minute.
  const budget = rateLimit(
    `auction:${user.id}`,
    AUCTION_CREATE_LIMIT.limit,
    AUCTION_CREATE_LIMIT.windowMs
  );
  if (!budget.allowed) {
    return {
      ok: false,
      rejection: {
        code: "rate_limited",
        message: "You're creating listings very quickly. Wait a minute and try again.",
      },
    };
  }

  const d = parsed.data;
  const { data, error } = await supabase
    .from("auctions")
    .insert({
      seller_id: user.id,
      title: d.title,
      description: d.description,
      category_id: d.categoryId,
      condition: d.condition,
      location: d.location,
      fulfilment_method: d.fulfilmentMethod ?? null,
      fulfilment_notes: d.fulfilmentNotes || null,
      currency: d.currency,
      starting_bid_minor: Number(d.startingBidMinor),
      bid_increment_minor: Number(d.bidIncrementMinor),
      duration_seconds: d.durationSeconds,
      anti_snipe_window_seconds: d.antiSnipeWindowSeconds,
      anti_snipe_extension_seconds: d.antiSnipeExtensionSeconds,
      status: "DRAFT",
      // image_count is deliberately absent: it is derived by the database
      // (sync_image_count trigger) and clients have no grant on it.
    })
    .select("id")
    .single();

  if (error) {
    return {
      ok: false,
      rejection: normalizeEngineError({ message: error.message, hint: error.hint }),
    };
  }

  revalidatePath("/sell");
  return { ok: true, auctionId: data.id as string };
}

/**
 * List an unsold auction again. Copies the seller's own UNSOLD auction into a
 * new DRAFT - same title, description, category, condition, location, pricing
 * and timing - so the seller only has to add photos and publish.
 *
 * Deliberately narrow:
 * - UNSOLD only. A cancelled auction was withdrawn on purpose; a sold one has
 *   a buyer. Neither may be duplicated into a fresh listing.
 * - Ownership is enforced twice: the read filters seller_id to the caller, so
 *   RLS returns nothing for anyone else's auction, and the status check then
 *   rejects anything that is not UNSOLD.
 * - Every copied field is re-validated through createAuctionSchema, the same
 *   schema the sell form uses. A value that was legal once but is not now is
 *   refused with field errors rather than written.
 * - Images are NOT copied: storage paths name their auction, and the old
 *   pictures belong to a closed listing. The new draft starts photo-less, and
 *   publish refuses it until photos are added - exactly like a fresh draft.
 * - Rate-limited under the same listing budget as creation: duplicating is
 *   creating, as far as abuse is concerned.
 */
export async function duplicateAuctionAction(input: {
  auctionId: string;
}): Promise<ActionResult<{ auctionId: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return {
      ok: false,
      rejection: { code: "not_authenticated", message: "Sign in to sell." },
    };
  }

  // Same door as creation: a suspended account cannot start a relist either.
  // The publish would be refused by the is_banned triggers regardless, but an
  // explicit refusal names the outcome instead of stranding a draft.
  const { data: duplicator } = await supabase
    .from("profiles")
    .select("is_banned")
    .eq("id", user.id)
    .maybeSingle();
  if (duplicator?.is_banned) {
    return {
      ok: false,
      rejection: {
        code: "account_banned",
        message:
          "Your account can't bid or list right now. If you think that's a mistake, get in touch.",
      },
    };
  }

  const budget = rateLimit(
    `auction:${user.id}`,
    AUCTION_CREATE_LIMIT.limit,
    AUCTION_CREATE_LIMIT.windowMs
  );
  if (!budget.allowed) {
    return {
      ok: false,
      rejection: {
        code: "rate_limited",
        message: "You're creating listings very quickly. Wait a minute and try again.",
      },
    };
  }

  const { data: source, error: readError } = await supabase
    .from("auctions")
    .select(
      `title, description, category_id, condition, location, fulfilment_method, fulfilment_notes, currency,
       starting_bid_minor, bid_increment_minor, duration_seconds,
       anti_snipe_window_seconds, anti_snipe_extension_seconds, status`
    )
    .eq("id", input.auctionId)
    .eq("seller_id", user.id)
    .maybeSingle();

  if (readError || !source) {
    return {
      ok: false,
      rejection: { code: "not_owner", message: "You don't own this auction." },
    };
  }
  if (source.status !== "UNSOLD") {
    return {
      ok: false,
      rejection: {
        code: "invalid_state",
        message: "Only an auction that ended with no bids can be listed again.",
      },
    };
  }

  const parsed = createAuctionSchema.safeParse({
    title: source.title,
    description: source.description,
    categoryId: source.category_id,
    condition: source.condition,
    location: source.location,
    fulfilmentMethod: source.fulfilment_method,
    fulfilmentNotes: source.fulfilment_notes ?? "",
    startingBidMinor: String(source.starting_bid_minor),
    bidIncrementMinor: String(source.bid_increment_minor),
    durationSeconds: source.duration_seconds,
    antiSnipeWindowSeconds: source.anti_snipe_window_seconds,
    antiSnipeExtensionSeconds: source.anti_snipe_extension_seconds,
    currency: source.currency,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      rejection: {
        code: "invalid_amount",
        message: "The original listing no longer meets the current rules.",
      },
      fieldErrors,
    };
  }

  const d = parsed.data;
  const { data, error } = await supabase
    .from("auctions")
    .insert({
      seller_id: user.id,
      title: d.title,
      description: d.description,
      category_id: d.categoryId,
      condition: d.condition,
      location: d.location,
      fulfilment_method: d.fulfilmentMethod ?? null,
      fulfilment_notes: d.fulfilmentNotes || null,
      currency: d.currency,
      starting_bid_minor: Number(d.startingBidMinor),
      bid_increment_minor: Number(d.bidIncrementMinor),
      duration_seconds: d.durationSeconds,
      anti_snipe_window_seconds: d.antiSnipeWindowSeconds,
      anti_snipe_extension_seconds: d.antiSnipeExtensionSeconds,
      status: "DRAFT",
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      rejection: normalizeEngineError({ message: error?.message ?? "" }),
    };
  }

  revalidatePath("/sell");
  revalidatePath("/dashboard/selling");
  return { ok: true, auctionId: data.id as string };
}

/**
 * Attach images to a draft. Called after Supabase Storage accepts the upload.
 * Validates that paths belong to this auction and that we stay under the cap.
 */
export async function attachImagesAction(input: {
  auctionId: string;
  images: Array<{ storagePath: string; width?: number; height?: number; bytes?: number }>;
}): Promise<ActionResult<{ count: number }>> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  const list = input.images.slice(0, 8);

  const { data: auction } = await supabase
    .from("auctions")
    .select("id, seller_id, status")
    .eq("id", input.auctionId)
    .single();

  if (!auction || auction.seller_id !== user.id) {
    return { ok: false, rejection: { code: "not_owner", message: "You don't own this auction." } };
  }
  if (!["DRAFT", "SCHEDULED", "LIVE"].includes(auction.status)) {
    return { ok: false, rejection: { code: "invalid_state", message: "Auction is closed." } };
  }

  // storage paths must be namespaced under this auction id (storage policy
  // enforces the same rule; this gives a clear message instead of a 403)
  const unsafe = list.find((img) => !img.storagePath.startsWith(`${input.auctionId}/`));
  if (unsafe) {
    return {
      ok: false,
      rejection: { code: "not_owner", message: "Invalid image path." },
    };
  }

  const rows = list.map((img, i) => ({
    auction_id: input.auctionId,
    storage_path: img.storagePath,
    position: i,
    width: img.width ?? null,
    height: img.height ?? null,
    bytes: img.bytes ?? null,
  }));

  const { error } = await supabase.from("auction_images").upsert(rows, {
    onConflict: "auction_id,storage_path",
    ignoreDuplicates: true,
  });
  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message }) };
  }

  const { count } = await supabase
    .from("auction_images")
    .select("id", { count: "exact", head: true })
    .eq("auction_id", input.auctionId);

  // `auctions.image_count` is NOT written here. It is maintained by the
  // sync_image_count trigger (migration 000008); clients hold no grant on it,
  // so any attempt would raise auction_state_immutable and be swallowed.
  revalidatePath(`/sell/${input.auctionId}`);
  return { ok: true, count: count ?? rows.length };
}

export async function updateAuctionFulfilmentAction(input: {
  auctionId: string;
  fulfilmentMethod: string;
  fulfilmentNotes?: string;
}): Promise<ActionResult> {
  const method = fulfilmentMethodSchema.safeParse(input.fulfilmentMethod);
  const notes = input.fulfilmentNotes?.trim() ?? "";
  if (!method.success || notes.length > 500) {
    return {
      ok: false,
      rejection: {
        code: "invalid_input",
        message: "Choose a fulfilment option and keep the notes under 500 characters.",
      },
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return {
      ok: false,
      rejection: { code: "not_authenticated", message: "Sign in." },
    };
  }

  const { error } = await supabase.rpc("set_auction_fulfilment", {
    p_auction_id: input.auctionId,
    p_method: method.data,
    p_notes: notes || null,
  });
  if (error) {
    return {
      ok: false,
      rejection: normalizeEngineError({ message: error.message, hint: error.hint }),
    };
  }

  revalidatePath(`/sell/${input.auctionId}`);
  revalidatePath(`/auction/${input.auctionId}`);
  return { ok: true };
}

export async function publishAuctionAction(input: unknown): Promise<
  ActionResult<{ status: string; endsAt: string }>
> {
  const parsed = publishAuctionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, rejection: { code: "invalid_state", message: "Invalid auction." } };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in to sell." } };
  }

  const { data, error } = await supabase.rpc("publish_auction", {
    p_auction_id: parsed.data.auctionId,
    p_starts_at: parsed.data.startsAt ?? null,
  });

  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message, hint: error.hint }) };
  }

  const payload = data as { status: string; ends_at: string; ok: boolean };

  // A held listing gets an email as well as the in-app notice: the seller
  // needs to know to wait, and "under review" with no message looks stuck.
  // Best-effort and keyed: a retry of this action reuses the row.
  if (payload.status === "PENDING_REVIEW") {
    await notifySeller(user.id, "review_submitted", { auctionId: parsed.data.auctionId }, emailKey("review_submitted", "auction", parsed.data.auctionId)).catch(() => undefined);
  }

  try {
    const admin = createAdminClient();
    const rt = createServerRealtime(admin);
    await rt.publish(parsed.data.auctionId, {
      type: "auction.updated",
      auctionId: parsed.data.auctionId,
      status: payload.status,
      currentBidMinor: null,
      bidCount: 0,
      endsAt: payload.ends_at,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[realtime] publish notify failed", err);
  }

  revalidatePath("/");
  revalidatePath("/browse");
  revalidatePath(`/auction/${parsed.data.auctionId}`);
  revalidatePath("/dashboard/selling");

  return { ok: true, status: payload.status, endsAt: payload.ends_at };
}

export async function cancelAuctionAction(input: {
  auctionId: string;
  reasonCode?: string;
  explanation?: string;
}): Promise<ActionResult<{ status: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  // Reason codes are the controlled vocabulary from CANCELLATION_REASONS: a
  // seller picks one, never free-types one, so a misleading reason cannot
  // smuggle an unlisted meaning into the audit row.
  if (
    input.reasonCode !== undefined &&
    !(CANCELLATION_REASONS as readonly string[]).includes(input.reasonCode)
  ) {
    return {
      ok: false,
      rejection: { code: "invalid_input", message: "Pick a reason from the list." },
    };
  }

  const { data, error } = await supabase.rpc("cancel_auction", {
    p_auction_id: input.auctionId,
    p_reason_code: input.reasonCode ?? null,
    p_explanation: input.explanation?.slice(0, 1000) ?? null,
  });
  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message, hint: error.hint }) };
  }

  revalidatePath(`/auction/${input.auctionId}`);
  revalidatePath("/dashboard/selling");
  return { ok: true, status: (data as { status: string }).status };
}

/**
 * Ask the team to end a live auction that has bids. The auction stays LIVE
 * while the request is pending - the request is a question, not a lever - and
 * the partial unique index refuses a second PENDING request for the same
 * auction, so double-submits collapse into the duplicate answer.
 */
export async function requestCancellationAction(input: {
  auctionId: string;
  reasonCode: string;
  explanation?: string;
}): Promise<ActionResult<{ status: string }>> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }
  if (!(CANCELLATION_REASONS as readonly string[]).includes(input.reasonCode)) {
    return {
      ok: false,
      rejection: { code: "invalid_input", message: "Pick a reason from the list." },
    };
  }

  const { data, error } = await supabase.rpc("request_cancellation", {
    p_auction_id: input.auctionId,
    p_reason_code: input.reasonCode,
    p_explanation: input.explanation?.slice(0, 1000) ?? null,
  });
  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message, hint: error.hint }) };
  }

  revalidatePath(`/auction/${input.auctionId}`);
  revalidatePath("/dashboard/selling");
  revalidatePath("/admin");
  return { ok: true, status: (data as { status: string }).status ?? "PENDING" };
}

/** Withdraw your own pending cancellation request. Never touches the auction. */
export async function withdrawCancellationAction(input: {
  requestId: string;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  const { error } = await supabase.rpc("withdraw_cancellation", {
    p_request_id: input.requestId,
  });
  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message, hint: error.hint }) };
  }

  revalidatePath("/dashboard/selling");
  revalidatePath("/admin");
  return { ok: true };
}

/** Withdraw your own pending listing review to edit and resubmit. */
export async function withdrawReviewAction(input: {
  auctionId: string;
}): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  const { error } = await supabase.rpc("withdraw_listing_review", {
    p_auction_id: input.auctionId,
  });
  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message, hint: error.hint }) };
  }

  revalidatePath(`/sell/${input.auctionId}`);
  revalidatePath("/dashboard/selling");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Closing is triggered by page views and by /api/cron/settle. Both funnel
 * through the same idempotent engine function.
 */
export async function settleIfDueAction(auctionId: string): Promise<{ settled: boolean }> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("settle_auction", { p_auction_id: auctionId });
  if (error) return { settled: false };
  const payload = data as {
    ok: boolean;
    already_settled?: boolean;
    status?: string;
    winner_id?: string;
    winning_bid_minor?: number | string;
    transaction_id?: string;
    currency?: string;
  };
  const settled = Boolean(payload?.ok) && payload?.status === "SOLD";
  if (settled) revalidatePath(`/auction/${auctionId}`);

  // Outcome emails, best-effort and keyed: a viewer-triggered settle that
  // actually closed the auction announces it once, however many viewers watch
  // the same countdown expire. already_settled runs skip silently because the
  // first settler already queued these keys.
  if (payload?.ok && !payload?.already_settled && (payload?.status === "SOLD" || payload?.status === "UNSOLD")) {
    const { notifySeller, notifyUser } = await import("@/server/email/notify");
    const { emailKey } = await import("@/server/email/sender");
    const { formatMoney, money } = await import("@/lib/money");
    const { data: closed } = await supabase
      .from("auctions")
      .select("id, title, seller_id")
      .eq("id", auctionId)
      .maybeSingle();
    const row = closed as { id: string; title: string; seller_id: string } | null;
    if (row) {
      if (payload.status === "SOLD" && payload.winner_id) {
        const amount = formatMoney(
          money(payload.winning_bid_minor ?? 0, payload.currency ?? "USD")
        );
        // Auction-scoped key, matching the cron sweeper below: one winner
        // per auction ever, so one key covers every trigger that might
        // announce it. A page view and a sweep racing the same close send one
        // email between them, not one each.
        await notifyUser(
          payload.winner_id,
          "won",
          { title: row.title, auctionId: row.id, amount },
          emailKey("won", "auction", row.id)
        ).catch(() => undefined);
      } else {
        await notifySeller(
          row.seller_id,
          "auction_unsold",
          { title: row.title, auctionId: row.id },
          emailKey("auction_unsold", "auction", row.id)
        ).catch(() => undefined);
      }
    }
  }
  return { settled };
}

/** Deletion is limited to untouched drafts. */
export async function deleteDraftAction(input: { auctionId: string }): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }
  const { error } = await supabase
    .from("auctions")
    .delete()
    .eq("id", input.auctionId)
    .eq("status", "DRAFT")
    .eq("bid_count", 0);
  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message }) };
  }
  revalidatePath("/sell");
  return { ok: true };
}

export async function newRequestId(): Promise<string> {
  return randomUUID();
}
