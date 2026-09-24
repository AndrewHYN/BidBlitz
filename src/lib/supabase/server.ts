import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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
