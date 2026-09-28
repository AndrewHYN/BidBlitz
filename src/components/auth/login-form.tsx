"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Gavel } from "lucide-react";
import { signInAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** NEXT_REDIRECT is navigation succeeding, not an error to render. */
function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export function LoginForm({
  redirectTo,
  initialError,
}: {
  redirectTo: string;
  initialError?: string;
}) {
  const [error, setError] = useState<string | null>(initialError ?? null);
  // See signup-form.tsx: `isPending` from `useTransition` is not synchronous,
  // so it cannot be what disables the button. `submitting` + `busyRef` make a
  // double-click a single sign-in request — repeated duplicate submissions are
  // exactly what turns an ordinary sign-in into a self-inflicted rate limit.
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return; // duplicate submit while the first is in flight

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");

    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    startTransition(async () => {
      try {
        const result = await signInAction({ email, password, redirectTo });
        if (!result.ok) setError(result.rejection.message);
      } catch (err) {
        if (isNextRedirect(err)) throw err; // signed in — let the router navigate
        setError("Sign in failed. Please try again.");
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      /*
       * Declared POST on purpose. This form is driven by a server action
       * through onSubmit, so it is not designed to work without JavaScript —
       * but "not designed to" is not "impossible": a user on a slow connection
       * who submits before hydration gets the browser's NATIVE submit, and a
       * form with no method defaults to GET, which puts the email AND the
       * password into the URL — into browser history, into proxy and access
       * logs, and into the Referer of the next navigation.
       *
       * POST means an un-hydrated submit fails visibly instead of leaking. Once
       * hydrated, onSubmit calls preventDefault and this attribute is never
       * consulted.
       */
      method="post"
      data-testid="login-form"
      className="space-y-5 rounded-xl border bg-card p-6 shadow-sm sm:p-8"
    >
      <div className="space-y-1.5 text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Gavel className="size-5" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          Welcome back
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign in to bid, sell and track your auctions.
        </p>
      </div>

      {error && (
        <div
          data-testid="auth-error"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          data-testid="email-field"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          data-testid="password-field"
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={submitting}
        aria-busy={submitting}
        data-testid="sign-in-button"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New to BidBlitz?{" "}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
