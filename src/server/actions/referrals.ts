"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const codeSchema = z.string().trim().toUpperCase().regex(/^BB[A-F0-9]{10}$/);

export async function redeemInvitationAction(value: unknown): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const parsed = codeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, message: "That invitation code is not valid." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in with your verified account to use this invitation." };
  const { data, error } = await supabase.rpc("redeem_referral_code", { p_code: parsed.data });
  if (!error && data?.ok === true) {
    revalidatePath("/referrals");
    return { ok: true };
  }
  const text = error?.message?.toLowerCase() ?? "";
  if (text.includes("already_redeemed")) return { ok: false, message: "This account has already accepted an invitation." };
  if (text.includes("self_referral")) return { ok: false, message: "You cannot invite yourself." };
  if (text.includes("new_verified_account_required")) return { ok: false, message: "Invitations require a verified account created within the last 30 days." };
  if (text.includes("prior_purchase_not_eligible")) return { ok: false, message: "Invitation codes are for first-time buyers." };
  return { ok: false, message: "This invitation could not be claimed. It may have expired or be invalid." };
}
