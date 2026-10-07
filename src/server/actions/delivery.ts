"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { releaseSellerPayout } from "@/server/payments/seller-payout";

const schema = z.object({
  transactionId: z.string().uuid("Invalid transaction"),
});

export async function confirmDeliveryAction(input: unknown): Promise<
  | { ok: true; payoutReleased: boolean; message: string }
  | { ok: false; message: string }
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid transaction." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };

  const { data, error } = await supabase.rpc("buyer_confirm_delivery", {
    p_transaction_id: parsed.data.transactionId,
  });

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("buyer_only")) return { ok: false, message: "Only the buyer can confirm handover." };
    if (m.includes("payment_not_confirmed")) return { ok: false, message: "The buyer payment must be confirmed first." };
    if (m.includes("payout_blocked")) return { ok: false, message: "This sale is on hold or disputed. Contact BidBlitz." };
    if (m.includes("transaction_not_found")) return { ok: false, message: "That sale is no longer available." };
    return { ok: false, message: "Handover confirmation was refused. Reload and try again." };
  }

  const payoutId = (data as { payout_id?: string } | null)?.payout_id;
  if (!payoutId) {
    return { ok: false, message: "Handover was recorded, but the seller payout could not be found." };
  }

  const release = await releaseSellerPayout(payoutId);

  revalidatePath("/dashboard/transactions");
  revalidatePath(`/dashboard/transactions/${parsed.data.transactionId}`);
  revalidatePath("/dashboard/selling");
  revalidatePath("/admin");

  if (release.ok) {
    return {
      ok: true,
      payoutReleased: true,
      message: "Handover confirmed. The seller payout was sent through Linkwa.",
    };
  }

  if (release.code === "payments_paused") {
    return {
      ok: true,
      payoutReleased: false,
      message: "Handover confirmed. Seller payout is queued until payments resume.",
    };
  }
  if (release.code === "provider_funds_pending") {
    return {
      ok: true,
      payoutReleased: false,
      message: "Handover confirmed. The seller payout is queued while Linkwa finishes settling the buyer payment.",
    };
  }
  if (release.code === "recipient_not_ready") {
    return {
      ok: true,
      payoutReleased: false,
      message: "Handover confirmed. The seller must finish payout setup before BidBlitz can send the proceeds.",
    };
  }

  return {
    ok: true,
    payoutReleased: false,
    message: "Handover confirmed. The payout needs a BidBlitz reconciliation check before any retry.",
  };
}
