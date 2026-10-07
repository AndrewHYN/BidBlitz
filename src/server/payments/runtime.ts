import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";

export async function paymentsRuntimeEnabled(): Promise<boolean> {
  if (!hasAdminCredentials()) return false;
  const { data, error } = await createAdminClient()
    .from("payment_settings")
    .select("payments_enabled")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return false;
  return data.payments_enabled === true;
}
