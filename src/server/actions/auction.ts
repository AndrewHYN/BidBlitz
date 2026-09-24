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
import { createAuctionSchema, publishAuctionSchema } from "@/lib/validation";
import { normalizeEngineError, type BidRejection } from "@/server/errors";

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
      currency: d.currency,
      starting_bid_minor: Number(d.startingBidMinor),
      bid_increment_minor: Number(d.bidIncrementMinor),
      duration_seconds: d.durationSeconds,
      anti_snipe_window_seconds: d.antiSnipeWindowSeconds,
      anti_snipe_extension_seconds: d.antiSnipeExtensionSeconds,
      status: "DRAFT",
      image_count: 0,
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

  const total = count ?? rows.length;
  await supabase
    .from("auctions")
    .update({ image_count: total })
    .eq("id", input.auctionId);

  revalidatePath(`/sell/${input.auctionId}`);
  return { ok: true, count: total };
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

export async function cancelAuctionAction(input: { auctionId: string }): Promise<
  ActionResult<{ status: string }>
> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  const { data, error } = await supabase.rpc("cancel_auction", {
    p_auction_id: input.auctionId,
  });
  if (error) {
    return { ok: false, rejection: normalizeEngineError({ message: error.message, hint: error.hint }) };
  }

  revalidatePath(`/auction/${input.auctionId}`);
  revalidatePath("/dashboard/selling");
  return { ok: true, status: (data as { status: string }).status };
}

/**
 * Closing is triggered by page views and by /api/cron/settle. Both funnel
 * through the same idempotent engine function.
 */
export async function settleIfDueAction(auctionId: string): Promise<{ settled: boolean }> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("settle_auction", { p_auction_id: auctionId });
  if (error) return { settled: false };
  const payload = data as { ok: boolean; already_settled?: boolean; status?: string };
  const settled = Boolean(payload?.ok) && payload?.status === "SOLD";
  if (settled) revalidatePath(`/auction/${auctionId}`);
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
