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
 *
 * `options` is a narrow passthrough for per-page auth behaviour — currently
 * only `detectSessionInUrl`. The email-link callback disables auto-detection
 * so the fragment is handled deterministically in one place (see
 * callback-runner.tsx): the library otherwise reads and clears
 * `window.location.hash` concurrently with the manual handling, which turns a
 * valid link into a race.
 */
export function createClient(options?: {
  auth?: { detectSessionInUrl?: boolean };
}) {
  const [resolvedUrl, resolvedKey] = requireConfig();
  return createBrowserClient(resolvedUrl, resolvedKey, options);
}
