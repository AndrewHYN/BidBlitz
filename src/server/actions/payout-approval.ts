"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";

export const HIGH_VALUE_PAYOUT_MINOR = 10_000;

type ApprovalResult = { ok: true; status: string } | { ok: false; message: string };

const requestSchema = z.object({
  payoutId: z.string().uuid(),
  reason: z.string().trim().min(15).max(1000),
}).strict();
const reviewSchema = z.object({
  requestId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().min(15).max(1000),
}).strict();

function friendlyError(error: string | undefined): string {
  const msg = error?.toLowerCase() ?? "";
  if (msg.includes("self_approval_forbidden")) return "A second independent staff member must review this request. You cannot approve your own request.";
  if (msg.includes("approval_already_active")) return "This payout already has an active approval request. Reload to see it.";
  if (msg.includes("approval_already_decided")) return "This approval was already decided. Reload.";
  if (msg.includes("dispute_open")) return "The dispute must be resolved before any payout approval.";
  if (msg.includes("payout_not_eligible")) return "This payout is no longer eligible. Confirm handover and buyer payment.";
  if (msg.includes("not_authorised")) return "Your staff role does not permit this approval.";
  return "The database refused this approval action. Nothing was sent to Linkwa.";
}

export async function requestPayoutApprovalAction(input: unknown): Promise<ApprovalResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a specific reason of at least 15 characters." };
  const allowed = await requirePermission("payouts.transition");
  if (!allowed.ok) return { ok: false, message: allowed.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_high_value_payout_approval", {
    p_payout_id: parsed.data.payoutId,
    p_reason: parsed.data.reason,
  });
  if (error || !data || data.ok !== true) return { ok: false, message: friendlyError(error?.message) };
  revalidatePath("/admin/finance/payouts");
  return { ok: true, status: "REQUESTED" };
}

export async function reviewPayoutApprovalAction(input: unknown): Promise<ApprovalResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write a reason of at least 15 characters." };
  const allowed = await requirePermission("payouts.review");
  if (!allowed.ok) return { ok: false, message: allowed.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_high_value_payout_approval", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note,
  });
  if (error || !data || data.ok !== true) return { ok: false, message: friendlyError(error?.message) };
  revalidatePath("/admin/finance/payouts");
  return { ok: true, status: parsed.data.approve ? "APPROVED" : "VOIDED" };
}
