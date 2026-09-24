import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

/**
 * Privileged server client — the ONLY place the secret key is read.
 *
 * Importing this module from anywhere in the client graph is a build error
 * thanks to `server-only`. Never use it to answer a request on behalf of a
 * user: it bypasses RLS entirely, so every call must do its own authorization.
 *
 * Current key model: SUPABASE_SECRET_KEY is an `sb_secret_...` string, not the
 * legacy `service_role` JWT.
 */
export function createAdminClient() {
  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured. Server-only operations require it."
    );
  }

  return createSupabaseClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * True when a privileged credential is actually configured. Used to render an
 * honest "configuration required" state instead of pretending a feature works.
 */
export function hasAdminCredentials(): boolean {
  return Boolean(url && secretKey);
}
