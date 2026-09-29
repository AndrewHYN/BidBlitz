"use server";

/**
 * Watchlist + notifications. Both are strictly per-user: RLS enforces
 * ownership, these actions only shape the payload.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { watchlistSchema, markNotificationsReadSchema } from "@/lib/validation";
import { normalizeEngineError, type BidRejection } from "@/server/errors";
import { REPORT_LIMIT, rateLimit } from "@/server/rate-limit";

export type SimpleResult =
  | { ok: true; [k: string]: unknown }
  | { ok: false; rejection: BidRejection };

export async function toggleWatchAction(input: unknown): Promise<
  SimpleResult & { watched: boolean }
> {
  const parsed = watchlistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, watched: false, rejection: { code: "invalid_request_id", message: "Invalid request." } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      watched: false,
      rejection: { code: "not_authenticated", message: "Sign in to save auctions." },
    };
  }

  const { auctionId, watched } = parsed.data;

  if (watched) {
    const { error } = await supabase
      .from("watchlist")
      .upsert({ user_id: user.id, auction_id: auctionId }, { onConflict: "user_id,auction_id", ignoreDuplicates: true });
    if (error) return { ok: false, watched: false, rejection: normalizeEngineError({ message: error.message }) };
  } else {
    const { error } = await supabase
      .from("watchlist")
      .delete()
      .eq("user_id", user.id)
      .eq("auction_id", auctionId);
    if (error) return { ok: false, watched: false, rejection: normalizeEngineError({ message: error.message }) };
  }

  revalidatePath(`/auction/${auctionId}`);
  revalidatePath("/dashboard/watchlist");
  return { ok: true, watched };
}

export async function markNotificationsReadAction(input: unknown): Promise<SimpleResult> {
  const parsed = markNotificationsReadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, rejection: { code: "invalid_request_id", message: "Invalid request." } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", parsed.data.ids)
    .eq("user_id", user.id);   // RLS enforces this too; belt and braces

  if (error) return { ok: false, rejection: normalizeEngineError({ message: error.message }) };

  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<SimpleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null)
    .eq("user_id", user.id);

  if (error) return { ok: false, rejection: normalizeEngineError({ message: error.message }) };

  revalidatePath("/notifications");
  return { ok: true };
}

export async function reportAction(input: unknown): Promise<SimpleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in to report." } };
  }

  // Per-account report budget (in-memory, see rate-limit.ts): reporting is a
  // deliberate moderation signal, not a repeated interaction.
  const budget = rateLimit(`report:${user.id}`, REPORT_LIMIT.limit, REPORT_LIMIT.windowMs);
  if (!budget.allowed) {
    return {
      ok: false,
      rejection: {
        code: "rate_limited",
        message: "Too many reports in a row. Wait a minute and try again.",
      },
    };
  }

  const { reportSchema } = await import("@/lib/validation");
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, rejection: { code: "invalid_request_id", message: parsed.error.issues[0]?.message ?? "Invalid report." } };
  }

  // The target must exist and be visible to the reporter, or the queue fills
  // with reports pointing nowhere. Auctions follow the same visibility rule
  // as browsing (public, own, or admin); profiles are public by design.
  if (parsed.data.targetType === "auction") {
    const { data: target } = await supabase
      .from("auctions")
      .select("id")
      .eq("id", parsed.data.targetId)
      .maybeSingle();
    if (!target) {
      return { ok: false, rejection: { code: "invalid_request_id", message: "That listing is no longer available." } };
    }
  } else {
    const { data: target } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", parsed.data.targetId)
      .maybeSingle();
    if (!target) {
      return { ok: false, rejection: { code: "invalid_request_id", message: "That account is no longer available." } };
    }
    if (target.id === user.id) {
      return { ok: false, rejection: { code: "invalid_request_id", message: "You can't report your own account." } };
    }
  }

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: parsed.data.targetType,
    target_id: parsed.data.targetId,
    reason: parsed.data.reason,
  });

  if (error) {
    // The (reporter, target) uniqueness violation is the duplicate-report
    // path, not a failure: the first report is already queued.
    const msg = `${error.message} ${(error as { code?: string }).code ?? ""}`;
    if (/23505|duplicate|already exists/i.test(msg)) {
      return {
        ok: false,
        rejection: {
          code: "duplicate_report",
          message: "You've already reported this. The team will review your first report.",
        },
      };
    }
    return { ok: false, rejection: normalizeEngineError({ message: error.message }) };
  }
  return { ok: true };
}

export async function submitReviewAction(input: unknown): Promise<SimpleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, rejection: { code: "not_authenticated", message: "Sign in." } };
  }

  const { reviewSchema } = await import("@/lib/validation");
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      rejection: {
        code: "invalid_request_id",
        message: parsed.error.issues[0]?.message ?? "Invalid review.",
      },
    };
  }

  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .select("id, auction_id, seller_id, buyer_id")
    .eq("id", parsed.data.transactionId)
    .single();

  if (txError || !tx) {
    return { ok: false, rejection: { code: "invalid_request_id", message: "Transaction not found." } };
  }

  const isSeller = tx.seller_id === user.id;
  const isBuyer = tx.buyer_id === user.id;
  if (!isSeller && !isBuyer) {
    return { ok: false, rejection: { code: "not_owner", message: "You weren't part of this sale." } };
  }

  const reviewee = isSeller ? tx.buyer_id : tx.seller_id;

  const { error } = await supabase.from("reviews").insert({
    transaction_id: tx.id,
    auction_id: tx.auction_id,
    reviewer_id: user.id,
    reviewee_id: reviewee,
    rating: parsed.data.rating,
    comment: parsed.data.comment || null,
  });

  if (error) {
    return {
      ok: false,
      rejection: normalizeEngineError({
        message: /duplicate|unique/i.test(error.message)
          ? "You've already reviewed this sale."
          : error.message,
      }),
    };
  }

  // Profile routes are keyed by USERNAME, not id — revalidate the real path
  // (and the pages that render this review) so nothing shows stale state.
  const { data: revieweeProfile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", reviewee)
    .maybeSingle();

  revalidatePath("/dashboard/transactions");
  revalidatePath("/dashboard");
  if (revieweeProfile?.username) {
    revalidatePath(`/profile/${revieweeProfile.username}`);
  }
  return { ok: true };
}
