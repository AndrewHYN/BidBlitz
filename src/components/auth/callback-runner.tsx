"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

/**
 * Completes an email-link sign-in in the browser — the only place all three
 * credential shapes are visible. Server components and route handlers never
 * receive the URL fragment, so `?code=` handling alone silently dropped the
 * recovery flow. Any failure lands on /login?error=callback, the same
 * fail-closed destination as before; invalid links never create a session.
 */
export function CallbackRunner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const next = safeNext(params.get("next"));
      const supabase = createClient();

      try {
        const code = params.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!cancelled) {
            if (error) router.replace("/login?error=callback");
            else router.replace(next);
          }
          return;
        }

        const tokenHash = params.get("token_hash");
        const type = params.get("type");
        if (
          tokenHash &&
          (type === "recovery" || type === "signup" || type === "email_change")
        ) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (!cancelled) {
            if (error) router.replace("/login?error=callback");
            else router.replace(next);
          }
          return;
        }

        const hash = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (!cancelled) {
            if (error) router.replace("/login?error=callback");
            else router.replace(next);
          }
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  return <p className="text-sm text-muted-foreground">Completing sign-in…</p>;
}
