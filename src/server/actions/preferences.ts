"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * The owner's own notification preferences: OPTIONAL mail only. Critical mail
 * (security, money, wins, cancellations, moderation decisions) bypasses these
 * flags in the dispatcher, so there is no code path here that can silence it.
 */

const preferencesSchema = z.object({
  outbid: z.boolean(),
  ending_soon: z.boolean(),
  marketplace_activity: z.boolean(),
});

export type EmailPreferences = z.infer<typeof preferencesSchema>;

export async function getPreferencesAction(): Promise<EmailPreferences> {
  const fallback = { outbid: true, ending_soon: true, marketplace_activity: false };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fallback;
  const { data } = await supabase
    .from("notification_preferences")
    .select("outbid, ending_soon, marketplace_activity")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return fallback;
  const row = data as Partial<EmailPreferences>;
  return {
    outbid: row.outbid !== false,
    ending_soon: row.ending_soon !== false,
    marketplace_activity: row.marketplace_activity === true,
  };
}

export async function updatePreferencesAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Those preferences were not valid." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in." };

  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: user.id,
      outbid: parsed.data.outbid,
      ending_soon: parsed.data.ending_soon,
      marketplace_activity: parsed.data.marketplace_activity,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, message: "We couldn't save that. Please try again." };
  revalidatePath("/settings");
  return { ok: true };
}
