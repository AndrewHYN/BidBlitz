import { Suspense } from "react";
import { CallbackRunner } from "@/components/auth/callback-runner";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Completing sign-in",
  description: "Completing sign-in from your BidBlitz email link.",
  robots: { index: false, follow: false },
};

/**
 * Email-link landing page. Supabase delivers the session three ways and only
 * the browser sees all of them:
 *
 *   - `?code=` — PKCE links, exchanged with exchangeCodeForSession;
 *   - `?token_hash=&type=` — server-initiated links, verified with verifyOtp;
 *   - `#access_token=&refresh_token=` — the implicit-fragment shape GoTrue
 *     actually emits for server-initiated recovery links. Fragments are never
 *     sent to a server, so the previous route-handler implementation could
 *     never complete these and bounced every valid reset click to
 *     /login?error=callback. This page runs client-side precisely so the
 *     fragment is readable.
 *
 * useSearchParams needs a Suspense boundary (Next.js build requirement).
 */
export default function AuthCallbackPage() {
  return (
    <div className="page-container flex min-h-[60vh] flex-col items-center justify-center py-10">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Completing sign-in…</p>}>
        <CallbackRunner />
      </Suspense>
    </div>
  );
}
