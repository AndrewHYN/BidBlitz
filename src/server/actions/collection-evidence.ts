"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseMoneyToMinor } from "@/lib/money";
import { requirePermission } from "@/server/permissions";

const request = z.object({
  transactionId: z.string().uuid(), collectionReference: z.string().trim().min(1).max(200),
  receivedAmount: z.string().trim().min(1).max(30), currency: z.literal("USD"),
  settlementReference: z.string().trim().min(6).max(200),
  source: z.enum(["MERCHANT_WALLET_RECEIPT", "MERCHANT_STATEMENT"]),
  note: z.string().trim().min(25).max(1500), fundsReceived: z.literal(true),
}).strict();

type Result = { ok: true; already: boolean } | { ok: false; message: string };
export async function recordMerchantCollectionAction(value: unknown): Promise<Result> {
  const parsed = request.safeParse(value);
  if (!parsed.success) return { ok: false, message: "Enter the exact collection and settlement references, received USD amount, evidence note and receipt confirmation." };
  const minor = parseMoneyToMinor(parsed.data.receivedAmount, "USD");
  if (minor === null || minor <= 0n || minor > 9223372036854775807n) return { ok: false, message: "Enter a valid USD amount with at most two decimal places." };
  const gate = await requirePermission("payouts.mark_paid");
  if (!gate.ok) return { ok: false, message: gate.message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_merchant_collection", {
    p_transaction_id: parsed.data.transactionId, p_collection_reference: parsed.data.collectionReference,
    p_gross_minor: minor.toString(), p_currency: parsed.data.currency,
    p_settlement_reference: parsed.data.settlementReference, p_source: parsed.data.source,
    p_note: parsed.data.note, p_funds_received: true,
  });
  if (error || data?.ok !== true || typeof data?.already !== "boolean") {
    const detail = error?.message ?? "";
    const message = detail.includes("does_not_match") ? "The payment reference, received amount or currency does not match this paid sale. Verify the original records."
      : detail.includes("non_live") ? "This is a historical test payment. It cannot clear real seller funds."
      : detail.includes("already_recorded") || detail.includes("unique") || detail.includes("duplicate")
        ? "This sale or settlement reference already has evidence. Review it before making another entry."
        : detail.includes("not_authorised") ? "Your finance role cannot verify merchant receipts."
          : "Receipt verification could not be confirmed. Reload this sale to check for recorded evidence.";
    return { ok: false, message };
  }
  for (const path of ["/admin/finance/payments", "/admin/finance/payouts", "/admin/finance", "/dashboard/account"]) revalidatePath(path);
  return { ok: true, already: data.already };
}
