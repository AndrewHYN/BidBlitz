"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";
import { parseCallbackCredentials } from "@/lib/auth-callback";
import { BrandMark } from "@/components/brand-mark";

/**
 * Completes an email-link sign-in in the browser — the only place all three
 * credential shapes are visible. Server components and route handlers never
 * receive the URL fragment, so `?code=` handling alone silently dropped the
 * recovery flow. Any failure lands on /login?error=callback, the same
 * fail-closed destination as before; invalid links never create a session.
 *
 * Auto-detection is disabled for this client (see `createClient`). The
 * underlying library otherwise processes `window.location.hash` on
 * initialization AND clears it (`window.location.hash = ''`) while this
 * effect reads it — a valid recovery link then looks credential-less and
 * bounces to /login?error=callback despite holding a good session. Handling
 * the fragment deterministically here removes the race. As a second guard,
 * an already-established session is honoured: if the credentials are gone
 * but a session exists, the user proceeds instead of failing closed on a
 * link the browser already consumed.
 */
export function CallbackRunner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function sessionExists(
      supabase: ReturnType<typeof createClient>
    ): Promise<boolean> {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return !!session;
      } catch {
        return false;
      }
    }

    async function run() {
      const next = safeNext(params.get("next"));
      // Deterministic handling: no concurrent auto-detection racing this
      // effect for the same fragment (see the note above).
      const supabase = createClient({ auth: { detectSessionInUrl: false } });

      try {
        // A session the browser already holds (second visit, back button, or
        // a link the auto-detector consumed before this build) is not a
        // failure — proceed where the link intended.
        if (await sessionExists(supabase)) {
          if (!cancelled) router.replace(next);
          return;
        }

        const credentials = parseCallbackCredentials(
          params,
          window.location.hash.slice(1)
        );

        if (credentials.kind === "code") {
          const { error } = await supabase.auth.exchangeCodeForSession(
            credentials.code
          );
          if (!cancelled) {
            if (error) {
              if (await sessionExists(supabase)) router.replace(next);
              else router.replace("/login?error=callback");
            } else router.replace(next);
          }
          return;
        }

        if (credentials.kind === "token") {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: credentials.tokenHash,
            type: credentials.type,
          });
          if (!cancelled) {
            if (error) {
              if (await sessionExists(supabase)) router.replace(next);
              else router.replace("/login?error=callback");
            } else router.replace(next);
          }
          return;
        }

        if (credentials.kind === "fragment") {
          const { error } = await supabase.auth.setSession({
            access_token: credentials.accessToken,
            refresh_token: credentials.refreshToken,
          });
          if (!cancelled) {
            if (error) {
              if (await sessionExists(supabase)) router.replace(next);
              else router.replace("/login?error=callback");
            } else {
              // Prove the session is readable (cookies set) before leaving:
              // the reset page is a server component that sees only cookies,
              // so navigating without them renders an expired-link state.
              if (await sessionExists(supabase)) router.replace(next);
              else router.replace("/login?error=callback");
            }
          }
          return;
        }

        // No credentials in the URL. One last check before failing closed:
        // the session may have been established before the fragment was
        // cleared (or the user is already signed in).
        if (await sessionExists(supabase)) {
          if (!cancelled) router.replace(next);
          return;
        }

        if (!cancelled) router.replace("/login?error=callback");
      } catch {
        if (!cancelled) {
          setError("We couldn't complete sign-in from your email link. Try again.");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [params, router]);

  if (error) {
    return (
      <div className="space-y-2 text-center">
        <BrandMark size={40} alt="BidBlitz" className="mx-auto" />
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 text-center">
      <BrandMark size={40} alt="BidBlitz" className="mx-auto" />
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}
