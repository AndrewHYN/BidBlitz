import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function requireConfig(): [string, string] {
  if (!url || !publishableKey) {
    throw new Error(
      "Missing Supabase configuration. Copy .env.example to .env.local and set " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }
  return [url, publishableKey];
}

/**
 * Browser client.
 *
 * Uses ONLY the publishable key (sb_publishable_...), which is safe to ship in
 * a bundle because every query it makes is constrained by RLS. The secret key
 * must never be imported into any module reachable from a client component.
 */
export function createClient() {
  const [resolvedUrl, resolvedKey] = requireConfig();
  return createBrowserClient(resolvedUrl, resolvedKey);
}
