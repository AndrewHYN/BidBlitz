"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";

type Result = { ok: true; status: string } | { ok: false; message: string };
const request = z.object({
  payoutId: z.string().uuid(),
  rail: z.enum(["SMILECASH", "ECOCASH"]),
  reason: z.string().trim().min(20).max(1000),
}).strict();
const receipt = z.object({
  payoutId: z.string().uuid(),
  reference: z.string().trim().min(6).max(200),
  note: z.string().trim().min(25).max(1500),
  sellerReceiptVerified: z.literal(true),
}).strict();
const cancel = z.object({
  payoutId: z.string().uuid(),
  reason: z.string().trim().min(25).max(1000),
  noTransferSent: z.literal(true),
}).strict();

function message(detail?: string): string {
  const value = detail?.toLowerCase() ?? "";
  if (value.includes("not_authorised")) return "Your staff role cannot perform this payout action or the seller receipt is unverified.";
  if (value.includes("historical_provider_attempt_exists") || value.includes("provider_payout_attempt_exists"))
    return "A provider instruction was previously recorded. Reconcile it before considering another payout.";
  if (value.includes("payout_not_eligible") || value.includes("external_payout_not_ready") ||
      value.includes("sale_not_payable"))
    return "The payout is not eligible. Check payment, handover, dispute and existing transfer records.";
  if (value.includes("recipient_phone_unavailable"))
    return "The seller must first register a valid phone number for receiving their transfer.";
  if (value.includes("duplicate key") || value.includes("unique constraint"))
    return "This payout or transfer reference already has a record. Do not send money again.";
  if (value.includes("payout_second_approval_required"))
    return "A second independent finance employee must approve this payout before it can be recorded.";
  if (value.includes("dispute_open"))
    return "This transaction is disputed. Seller funds must remain held.";
  if (value.includes("claim_not_cancellable"))
    return "This reservation is no longer cancellable. Reconcile the external transfer.";
  return "The database refused this change. Reload the payout worklist before further action.";
}

export async function reserveExternalPayoutAction(value: unknown): Promise<Result> {
  const parsed = request.safeParse(value);
  if (!parsed.success) return { ok: false, message: "Enter a valid seller payout, wallet rail and reason of at least 20 characters." };
  const gate = await requirePermission("payouts.transition");
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_reserve_external_seller_payout", {
    p_payout_id: parsed.data.payoutId,
    p_rail: parsed.data.rail,
    p_reason: parsed.data.reason,
  });
  if (error || data?.ok !== true) return { ok: false, message: message(error?.message) };
  revalidatePath("/admin/finance/payouts");
  return { ok: true, status: "RESERVED" };
}

export async function confirmExternalPayoutAction(value: unknown): Promise<Result> {
  const parsed = receipt.safeParse(value);
  if (!parsed.success) return {
    ok: false, message: "Provide the exact transfer reference, an evidence note and confirm you verified the seller's receipt.",
  };
  const gate = await requirePermission("payouts.mark_paid");
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_confirm_external_seller_payout", {
    p_payout_id: parsed.data.payoutId,
    p_receipt_reference: parsed.data.reference,
    p_receipt_note: parsed.data.note,
    p_seller_receipt_verified: true,
  });
  if (error || data?.ok !== true || data?.status !== "PAID_OUT") {
    return { ok: false, message: message(error?.message) };
  }
  revalidatePath("/admin/finance/payouts");
  revalidatePath("/admin/finance");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/dashboard/selling");
  return { ok: true, status: "PAID_OUT" };
}

export async function cancelExternalPayoutAction(value: unknown): Promise<Result> {
  const parsed = cancel.safeParse(value);
  if (!parsed.success) return { ok: false, message: "You must affirm no money was sent and explain the cancellation." };
  const gate = await requirePermission("payouts.transition");
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_cancel_external_seller_payout", {
    p_payout_id: parsed.data.payoutId,
    p_no_transfer_sent: true,
    p_reason: parsed.data.reason,
  });
  if (error || data?.ok !== true) return { ok: false, message: message(error?.message) };
  revalidatePath("/admin/finance/payouts");
  return { ok: true, status: "CANCELLED" };
}
