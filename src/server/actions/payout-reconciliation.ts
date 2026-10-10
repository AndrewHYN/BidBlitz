"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";

const schema = z.object({
  payoutId: z.string().uuid(),
  kind: z.enum(["INVESTIGATION", "PROVIDER_REFERENCE", "SELLER_RECEIPT"]),
  reference: z.string().trim().max(200).default(""),
  note: z.string().trim().min(25).max(1500),
  sellerReceiptVerified: z.boolean(),
}).strict();

type Result = { ok: true; status: "RECORDED" } | { ok: false; message: string };

/** Evidence is append-only. This never sends a payout or marks one paid. */
export async function recordPayoutReconciliationAction(input: unknown): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid payout, reference and evidence note (at least 25 characters)." };
  const { kind, reference, sellerReceiptVerified, payoutId, note } = parsed.data;
  if ((kind === "INVESTIGATION" && (reference || sellerReceiptVerified))
    || (kind === "PROVIDER_REFERENCE" && (reference.length < 6 || sellerReceiptVerified))
    || (kind === "SELLER_RECEIPT" && (reference.length < 6 || !sellerReceiptVerified))) {
    return { ok: false, message: "An investigation cannot claim a transfer; a verified seller receipt needs a real provider reference and explicit independent confirmation." };
  }
  const access = await requirePermission("payouts.mark_paid");
  if (!access.ok) return { ok: false, message: access.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_record_payout_reconciliation", {
    p_payout_id: payoutId, p_kind: kind, p_reference: reference || null,
    p_note: note, p_seller_receipt_verified: sellerReceiptVerified,
  });
  if (error || data?.ok !== true || data?.status !== "RECORDED") {
    const lower = error?.message.toLowerCase() ?? "";
    const message = lower.includes("reference_owned_by_another_payout")
      ? "This reference belongs to a different seller payout. Check the original payment."
      : lower.includes("provider_reference_mismatch")
        ? "The reference differs from the immutable provider reference already on file."
        : "Evidence was not recorded. Refresh the payout desk and verify the current state; no transfer was attempted.";
    return { ok: false, message };
  }
  revalidatePath("/admin/finance/payouts");
  return { ok: true, status: "RECORDED" };
}
