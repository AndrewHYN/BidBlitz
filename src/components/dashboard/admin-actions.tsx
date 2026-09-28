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
    return "Add the payout reference first — a payout can only be recorded with it.";
  }
  if (m.includes("payout_admin_only")) return "Admins only.";
  if (m.includes("payout_not_found")) return "That payout no longer exists.";
  if (m.includes("payout_invalid_transition")) {
    return "That step isn't available from the payout's current status.";
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
