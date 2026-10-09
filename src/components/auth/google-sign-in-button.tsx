"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { googleOAuthRedirectTo } from "@/lib/oauth-redirect";
import { Button } from "@/components/ui/button";

/**
 * Official Google "G" mark (four-color paths), inline so no request, no
 * sprite, no fake generic icon. Decorative here: the button's accessible
 * name comes from its text content.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

/**
 * Primary Google entry point, shared by login and signup.
 *
 * This MUST run in the browser: `signInWithOAuth` stores the PKCE verifier
 * where the callback can read it, and the same-browser `/auth/callback`
 * `?code=` branch completes the session — the one callback architecture, not
 * a second one. A server action could neither hold the verifier nor receive
 * the redirect, so there is deliberately no action here.
 *
 * Failure is always the same safe sentence: the provider being disabled in
 * the dashboard and a dropped network look identical on purpose, because a
 * "Google is not configured" message would fingerprint the deployment.
 */
export function GoogleSignInButton({ next }: { next?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function start() {
    if (busyRef.current) return; // one click, one OAuth attempt
    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: googleOAuthRedirectTo(next) },
      });
      if (oauthError || !data.url) {
        setError("Couldn't start Google sign-in. Please try again.");
        return;
      }
      // Hand the browser to Google; Supabase returns it to /auth/callback.
      window.location.assign(data.url);
    } catch {
      setError("Couldn't start Google sign-in. Please try again.");
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full shadow-sm"
        disabled={submitting}
        aria-busy={submitting}
        onClick={() => void start()}
        data-testid="google-sign-in-button"
      >
        <GoogleMark />
        {submitting ? "Continuing…" : "Continue with Google"}
      </Button>
      {error && (
        <p
          role="alert"
          data-testid="oauth-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
