import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Server client bound to the CALLER'S session.
 *
 * Server Actions and Server Components use this so every query runs as the
 * signed-in user and is therefore subject to RLS. It holds the publishable key
 * only — no privileged credential exists on this path, which means a bug in a
 * server action cannot escalate past what the user is allowed to do.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(url!, publishableKey!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component where writes are illegal; the
          // middleware refreshes sessions, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Sessionless signup client (implicit flow, no cookie jar).
 *
 * Production incident 2026-10-04: email-confirmation links failed for every
 * user with "We couldn't complete sign-in from your email link."
 *
 * The signup Server Action used the session-bound client above, whose
 * flowType is unconditionally `"pkce"`. That made GoTrue redirect the
 * confirmation click to `/auth/callback?code=…`, which can only be exchanged
 * with the PKCE verifier stored in a cookie during signup. But the
 * production signup email points at a DIFFERENT host than the signup page
 * (`NEXT_PUBLIC_SITE_URL` baked the Vercel domain while users sign up on the
 * custom domain), and host-bound cookies never cross that boundary — so the
 * verifier was systematically absent and every exchange failed. The same
 * fragility bites same-domain users who confirm on another device or after
 * clearing cookies.
 *
 * This client sends signup with the implicit flow instead, so GoTrue
 * redirects with `#access_token/refresh_token` and the existing fragment
 * branch of `/auth/callback` establishes the session with no verifier, no
 * cookies, and no device affinity — the same shape password recovery
 * already relies on. Publishable key only, nothing persisted, nothing
 * session-bound: an unconfirmed signup has no session to hold.
 */
export function createSignupClient() {
  return createSupabaseJsClient(url!, publishableKey!, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
