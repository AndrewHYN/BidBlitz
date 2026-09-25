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

  if (error) return { ok: false, message: error.message };

  revalidatePath("/admin");
  return { ok: true, status: parsed.data.status };
}
