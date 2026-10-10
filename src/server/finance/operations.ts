import "server-only";

import { createClient } from "@/lib/supabase/server";
import { parseFinanceOperations, type FinanceOperations } from "@/lib/finance/operations";

export type FinanceLoadResult =
  | { ok: true; data: FinanceOperations }
  | { ok: false; message: string };

/**
 * The database function is SECURITY DEFINER but checks live financial
 * permissions and returns a bounded projection. Never call the service-role
 * client from this staff page or silently convert failed reads to [].
 */
export async function readFinanceOperations(limit = 75): Promise<FinanceLoadResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_finance_operations", { p_limit: limit });
  if (error) {
    console.error("[finance/operations] Could not load staff finance projection", {
      code: error.code, message: error.message,
    });
    return { ok: false, message: "Finance transaction and payout details could not be verified. Do not take payout actions until this is resolved." };
  }
  const parsed = parseFinanceOperations(data);
  if (!parsed) {
    console.error("[finance/operations] Invalid staff finance projection shape");
    return { ok: false, message: "Finance data was incomplete. No payout action is available." };
  }
  return { ok: true, data: parsed };
}
