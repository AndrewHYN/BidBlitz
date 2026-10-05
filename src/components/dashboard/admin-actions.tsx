"use server";

/**
 * Admin-only mutations live in their own `"use server"` module so nothing on
 * this surface can be reached without the same checks: Zod first, then the
 * caller's own session, then `profiles.is_admin` on that session's own row —
 * RLS backs all three. (The `is_admin()` SQL function moved to the `private`
 * schema in migration 000010, so it is no longer a PostgREST RPC; the column
 * read below is the same fact, fetched through the normal row policies.)
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const updateReportStatusSchema = z.object({
  reportId: z.string().uuid("Invalid report"),
  status: z.enum(["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"]),
});

export async function updateReportStatusAction(
  input: unknown
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const parsed = updateReportStatusSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid report.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  // Status only: resolutions are typed by humans, never by this button.
  const { error } = await supabase
    .from("reports")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.reportId);

  // Never pass a raw database error to the browser. PostgREST messages quote
  // relation names, constraint names and occasionally values, which is noise
  // for an operator at best and a small information leak at worst. The real
  // diagnostic is the server log, which already has it.
  if (error) return { ok: false, message: "That report update was refused. Reload and try again." };

  revalidatePath("/admin");
  return { ok: true, status: parsed.data.status };
}

// ---------------------------------------------------------------------------
// Moderation enforcement
// ---------------------------------------------------------------------------

const takedownSchema = z.object({
  auctionId: z.string().uuid("Invalid auction"),
  reason: z
    .string()
    .trim()
    .min(5, "Give a reason of at least 5 characters.")
    .max(1000, "Reason is too long."),
  reportId: z.string().uuid("Invalid report").optional(),
});

/**
 * Remove a listing as the operator. Goes through
 * `admin_takedown_auction()`, which locks the row, refuses anything already
 * closed or still a draft, records CANCELLED, writes the moderation_events
 * audit row (actor, previous status, reason, report), notifies the seller
 * with safe copy, and resolves the originating report.
 *
 * The admin check happens twice, on purpose: here, for a fast honest refusal
 * before any RPC, and inside the function, which is the boundary that matters
 * because the RPC is directly callable. Either one alone would be a UI
 * restriction pretending to be authorization.
 */
export async function takedownAuctionAction(
  input: unknown
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const parsed = takedownSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid takedown.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  const { data, error } = await supabase.rpc("admin_takedown_auction", {
    p_auction_id: parsed.data.auctionId,
    p_reason: parsed.data.reason,
    p_report_id: parsed.data.reportId ?? null,
  });

  if (error) return { ok: false, message: takedownErrorMessage(error.message) };

  {
    const { notifySeller } = await import("@/server/email/notify");
    const { emailKey } = await import("@/server/email/sender");
    const info = await auctionContacts(supabase, parsed.data.auctionId);
    if (info) {
      await notifySeller(info.sellerId, "listing_removed", {
        title: info.title,
        auctionId: info.id,
      }, emailKey("listing_removed", "auction", info.id)).catch(() => undefined);
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/auction/${parsed.data.auctionId}`);
  revalidatePath("/dashboard/selling");
  revalidatePath("/");
  revalidatePath("/browse");
  return { ok: true, status: (data as { status?: string } | null)?.status ?? "CANCELLED" };
}

/** Map the takedown function's refusal codes to copy an operator can act on. */
function takedownErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("not_admin")) return "Admins only.";
  if (m.includes("auction_not_found")) return "That auction no longer exists.";
  if (m.includes("invalid_reason")) return "Give a reason of at least 5 characters.";
  if (m.includes("invalid_state"))
    return "That auction is already closed or still a draft. There is nothing to take down.";
  if (m.includes("not_authenticated")) return "Sign in.";
  return "That takedown was refused. Reload and try again.";
}

const banSchema = z.object({
  userId: z.string().uuid("Invalid user"),
  banned: z.boolean(),
  reason: z
    .string()
    .trim()
    .min(5, "Give a reason of at least 5 characters.")
    .max(1000, "Reason is too long."),
  reportId: z.string().uuid("Invalid report").optional(),
});

/**
 * Suspend or restore an account as the operator. Goes through
 * `admin_set_banned()`, which refuses self-ban, is idempotent when already in
 * the requested state, and writes the moderation_events audit row. The actual
 * blocking is done by the is_banned triggers, unchanged: bids, publishing and
 * listing creation are refused at the database boundary, not by hiding
 * buttons.
 */
export async function setBannedAction(
  input: unknown
): Promise<{ ok: true; banned: boolean } | { ok: false; message: string }> {
  const parsed = banSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  const { data, error } = await supabase.rpc("admin_set_banned", {
    p_user_id: parsed.data.userId,
    p_banned: parsed.data.banned,
    p_reason: parsed.data.reason,
    p_report_id: parsed.data.reportId ?? null,
  });

  if (error) return { ok: false, message: banErrorMessage(error.message) };

  {
    const { notifyUser } = await import("@/server/email/notify");
    const { emailKey } = await import("@/server/email/sender");
    await notifyUser(
      parsed.data.userId,
      parsed.data.banned ? "account_suspended" : "account_restored",
      { reason: parsed.data.reason },
      emailKey(parsed.data.banned ? "account_suspended" : "account_restored", "user", parsed.data.userId)
    ).catch(() => undefined);
  }

  revalidatePath("/admin");
  return {
    ok: true,
    banned: (data as { is_banned?: boolean } | null)?.is_banned ?? parsed.data.banned,
  };
}

/** Map the ban function's refusal codes to copy an operator can act on. */
function banErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("not_admin")) return "Admins only.";
  if (m.includes("cannot_ban_self")) return "You can't suspend your own account.";
  if (m.includes("user_not_found")) return "That account no longer exists.";
  if (m.includes("invalid_reason")) return "Give a reason of at least 5 characters.";
  if (m.includes("not_authenticated")) return "Sign in.";
  return "That action was refused. Reload and try again.";
}

/**
 * Title + seller for an auction the operator just acted on, so the email
 * fan-out below names something real. Admin-visible read; null when gone.
 */
async function auctionContacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  auctionId: string
): Promise<{ id: string; title: string; sellerId: string } | null> {
  const { data } = await supabase
    .from("auctions")
    .select("id, title, seller_id")
    .eq("id", auctionId)
    .maybeSingle();
  const row = data as { id: string; title: string; seller_id: string } | null;
  return row ? { id: row.id, title: row.title, sellerId: row.seller_id } : null;
}

/**
 * Decide a seller's cancellation request. Approving ends a live auction with
 * bids and notifies every bidder; rejecting changes nothing about the auction
 * and tells the seller why. Either way the request row records reviewer,
 * decision and timestamp.
 */
export async function decideCancellationAction(input: unknown): Promise<
  { ok: true; decision: string } | { ok: false; message: string }
> {
  const parsed = z
    .object({
      requestId: z.string().uuid("Invalid request"),
      approve: z.boolean(),
      reason: z.string().trim().max(1000, "Reason is too long.").optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid decision.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  const { data, error } = await supabase.rpc("decide_cancellation", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) return { ok: false, message: decideCancellationErrorMessage(error.message) };

  // Emails follow the decision, not the click: approval reaches the seller
  // and every bidder (the request row holds the auction), rejection reaches
  // only the seller, with the reason. Keyed per decision outcome so a retry
  // cannot invite a second wave.
  {
    const { notifyAuctionAudience, notifySeller } = await import("@/server/email/notify");
    const { emailKey } = await import("@/server/email/sender");
    const { data: reqRow } = await supabase
      .from("auction_cancellation_requests")
      .select("auction_id")
      .eq("id", parsed.data.requestId)
      .maybeSingle();
    const targetId = (reqRow as { auction_id?: string } | null)?.auction_id;
    const info = targetId ? await auctionContacts(supabase, targetId) : null;
    if (info) {
      if (parsed.data.approve) {
        await notifyAuctionAudience(info.id, info.sellerId, "auction_cancelled", {
          title: info.title,
          auctionId: info.id,
        }, emailKey("auction_cancelled", "decision", parsed.data.requestId)).catch(() => undefined);
      }
      await notifySeller(info.sellerId, "cancellation_decided", {
        title: info.title,
        auctionId: info.id,
        approved: parsed.data.approve ? "true" : "false",
        reason: parsed.data.reason ?? "",
      }, emailKey("cancellation_decided", "decision", parsed.data.requestId)).catch(() => undefined);
    }
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard/selling");
  return { ok: true, decision: (data as { decision?: string })?.decision ?? "" };
}

function decideCancellationErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("not_admin")) return "Admins only.";
  if (m.includes("request_not_found")) return "That request no longer exists.";
  if (m.includes("invalid_state"))
    return "That request was already decided or withdrawn.";
  if (m.includes("invalid_reason")) return "A rejection needs a reason of at least 5 characters.";
  if (m.includes("auction_not_found")) return "That auction no longer exists.";
  if (m.includes("not_authenticated")) return "Sign in.";
  return "That decision was refused. Reload and try again.";
}

/**
 * Pause or resume a live auction as the operator. Pause freezes bidding and
 * the clock with history intact; resume shifts the end forward by exactly the
 * held duration. Both write the moderation trail.
 */
export async function pauseAuctionAction(input: unknown): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const parsed = z
    .object({
      auctionId: z.string().uuid("Invalid auction"),
      reason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid pause." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  const { error } = await supabase.rpc("admin_pause_auction", {
    p_auction_id: parsed.data.auctionId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: pauseErrorMessage(error.message) };

  // Seller plus every bidder: a pause changes what everyone may do, so
  // everyone hears it. Keyed on the auction, so re-pausing after a resume
  // (a new hold) is a new email, while a double-click is not.
  {
    const { notifyAuctionAudience } = await import("@/server/email/notify");
    const { emailKey } = await import("@/server/email/sender");
    const info = await auctionContacts(supabase, parsed.data.auctionId);
    if (info) {
      await notifyAuctionAudience(info.id, info.sellerId, "auction_paused", {
        title: info.title,
        auctionId: info.id,
      }, emailKey("auction_paused", "auction", info.id)).catch(() => undefined);
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/auction/${parsed.data.auctionId}`);
  revalidatePath("/dashboard/selling");
  revalidatePath("/");
  revalidatePath("/browse");
  return { ok: true };
}

export async function resumeAuctionAction(input: unknown): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const parsed = z
    .object({
      auctionId: z.string().uuid("Invalid auction"),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid resume." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  const { data, error } = await supabase.rpc("admin_resume_auction", {
    p_auction_id: parsed.data.auctionId,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { ok: false, message: pauseErrorMessage(error.message) };

  {
    const { notifyAuctionAudience } = await import("@/server/email/notify");
    const { emailKey } = await import("@/server/email/sender");
    const info = await auctionContacts(supabase, parsed.data.auctionId);
    if (info) {
      await notifyAuctionAudience(info.id, info.sellerId, "auction_resumed", {
        title: info.title,
        auctionId: info.id,
        endsAt: (data as { ends_at?: string })?.ends_at ?? "",
      }, emailKey("auction_resumed", "auction", info.id)).catch(() => undefined);
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/auction/${parsed.data.auctionId}`);
  revalidatePath("/dashboard/selling");
  revalidatePath("/");
  revalidatePath("/browse");
  return { ok: true };
}

function pauseErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("not_admin")) return "Admins only.";
  if (m.includes("auction_not_found")) return "That auction no longer exists.";
  if (m.includes("invalid_reason")) return "Give a reason of at least 5 characters.";
  if (m.includes("invalid_state"))
    return "That auction is not in a state this action applies to.";
  if (m.includes("not_authenticated")) return "Sign in.";
  return "That action was refused. Reload and try again.";
}

/**
 * Decide a listing review. Approving publishes on the original schedule (or
 * live from approval); rejecting or requesting changes returns the draft with
 * the reason the seller needs. The review row records reviewer, decision and
 * timestamp either way.
 */
export async function decideReviewAction(input: unknown): Promise<
  { ok: true; decision: string } | { ok: false; message: string }
> {
  const parsed = z
    .object({
      reviewId: z.string().uuid("Invalid review"),
      decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
      reason: z.string().trim().max(1000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid decision." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  const { data, error } = await supabase.rpc("admin_decide_review", {
    p_review_id: parsed.data.reviewId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { ok: false, message: reviewErrorMessage(error.message) };

  // The seller hears the decision by email as well as in-app: an approval
  // they miss is a sale that never starts, and a rejection they miss never
  // gets fixed. Best-effort, keyed on the review so a double-click sends one.
  {
    const { notifySeller } = await import("@/server/email/notify");
    const { emailKey } = await import("@/server/email/sender");
    const { data: reviewRow } = await supabase
      .from("listing_reviews")
      .select("auction_id")
      .eq("id", parsed.data.reviewId)
      .maybeSingle();
    const auctionId = (reviewRow as { auction_id?: string } | null)?.auction_id;
    const { data: decided } = auctionId
      ? await supabase
          .from("auctions")
          .select("id, title, seller_id")
          .eq("id", auctionId)
          .maybeSingle()
      : { data: null };
    const row = decided as { id: string; title: string; seller_id: string } | null;
    if (row) {
      const template =
        parsed.data.decision === "APPROVED"
          ? "review_approved"
          : parsed.data.decision === "REJECTED"
            ? "review_rejected"
            : "review_changes";
      await notifySeller(row.seller_id, template, {
        title: row.title,
        auctionId: row.id,
        reason: parsed.data.reason ?? "",
      }, emailKey(template, "review", parsed.data.reviewId)).catch(() => undefined);
    }
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard/selling");
  return { ok: true, decision: (data as { decision?: string })?.decision ?? "" };
}

function reviewErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("not_admin")) return "Admins only.";
  if (m.includes("review_not_found")) return "That review no longer exists.";
  if (m.includes("invalid_state"))
    return "That review was already decided or withdrawn.";
  if (m.includes("invalid_reason"))
    return "Rejecting or requesting changes needs a reason of at least 5 characters.";
  if (m.includes("auction_not_found")) return "That auction no longer exists.";
  if (m.includes("not_authenticated")) return "Sign in.";
  return "That decision was refused. Reload and try again.";
}

// ---------------------------------------------------------------------------
// Seller payouts
// ---------------------------------------------------------------------------

const PAYOUT_TARGETS = [
  "WAITING_FOR_FULFILMENT",
  "DELIVERY_CONFIRMED",
  "PAYOUT_PENDING",
  "PAYOUT_DUE",
  "PAID_OUT",
  "HELD",
  "DISPUTED",
] as const;

const payoutActionSchema = z.object({
  payoutId: z.string().uuid("Invalid payout"),
  status: z.enum(PAYOUT_TARGETS),
  reference: z.string().trim().max(200, "Reference is too long.").optional(),
  note: z.string().trim().max(500, "Note is too long.").optional(),
});

/** Map the database's own refusal codes to copy an operator can act on. */
function payoutErrorMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("payout_reference_required")) {
    return "Add the payout reference first. A payout can only be recorded with it.";
  }
  if (m.includes("payout_admin_only")) return "Admins only.";
  if (m.includes("payout_not_found")) return "That payout no longer exists.";
  if (m.includes("payout_invalid_transition")) {
    return "That step isn't available from the payout's current status.";
  }
  if (m.includes("payout_delivery_not_confirmed")) {
    return "Confirm delivery first. A payout can't be marked due before the sale is confirmed delivered.";
  }
  if (m.includes("payout_delivery_immutable")) {
    return "Delivery is recorded by confirming delivery (or restarting fulfilment), not by editing this field.";
  }
  if (m.includes("payout_paid_out_immutable")) {
    return "This payout is already recorded as paid out and can't be changed.";
  }
  if (m.includes("payout_transaction_not_payable")) {
    return "This payment isn't in a state the payout can be recorded against.";
  }
  if (m.includes("payout_money_immutable")) {
    return "The payout amount is fixed when the record is created.";
  }
  if (m.includes("payout_state_immutable")) return "Admins only.";
  if (m.includes("already registered") || m.includes("row-level security")) {
    return "Not permitted.";
  }
  return "That payout update was refused. Reload and try again.";
}

/**
 * The only way a seller payout status changes.
 *
 * Three gates, in order: Zod on the body, the caller's own session, and then
 * `admin_transition_seller_payout()` — a SECURITY DEFINER function that reads
 * `profiles.is_admin` on that same session. Nothing about the money is
 * accepted from the browser: the amount and currency are already frozen in
 * the row, and `PAID_OUT` only ever records that a human transferred the
 * proceeds outside the application.
 */
export async function sellerPayoutAction(input: unknown): Promise<
  { ok: true; status: string } | { ok: false; message: string }
> {
  const parsed = payoutActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid payout update.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, message: "Admins only." };

  const { data, error } = await supabase.rpc("admin_transition_seller_payout", {
    p_payout_id: parsed.data.payoutId,
    p_to_status: parsed.data.status,
    p_payout_reference: parsed.data.reference ?? null,
    p_internal_note: parsed.data.note ?? null,
  });

  if (error) return { ok: false, message: payoutErrorMessage(error.message) };

  const status = (data as { status?: string } | null)?.status ?? parsed.data.status;
  revalidatePath("/admin");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/dashboard/selling");
  return { ok: true, status };
}
