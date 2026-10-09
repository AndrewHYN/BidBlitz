"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { releaseSellerPayout } from "@/server/payments/seller-payout";

const schema = z.object({ payoutId: z.string().uuid("Invalid payout") }).strict();

type Result =
  | { ok: true; payoutReference: string }
  | { ok: false; message: string };

/**
 * Admin fallback only. Normal seller release happens after buyer-confirmed
 * handover. This action deliberately delegates to the exact same payout
 * service so there is only one money-moving implementation.
 */
export async function initiateLinkwaPayoutAction(input: unknown): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid payout request." };
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

  const released = await releaseSellerPayout(parsed.data.payoutId);
  if (!released.ok) return { ok: false, message: released.message };

  revalidatePath("/admin");
  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/payouts");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/dashboard/selling");
  return { ok: true, payoutReference: released.payoutReference };
}
