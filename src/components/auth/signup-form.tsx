"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import { signUpAction } from "@/server/actions/auth";
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

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set only when the account was created AND email confirmation is pending.
  const [sentTo, setSentTo] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (!displayName) {
      setError("Enter your name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await signUpAction({ email, password, displayName });
        if (!result.ok) {
          setError(result.rejection.message);
          return;
        }
        // Email confirmation is ON: no session means the account exists but
        // is not usable yet — say exactly that, never "you're all set".
        setSentTo(email);
      } catch (err) {
        if (isNextRedirect(err)) throw err; // session created + confirmed: navigate
        setError("Account creation failed. Please try again.");
      }
    });
  }

  if (sentTo !== null) {
    return (
      <div
        data-testid="check-email-message"
        className="space-y-4 rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8"
      >
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            Confirm your email
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to <strong className="break-all text-foreground">{sentTo}</strong>.
            Confirm it, then sign in.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="signup-form"
      className="space-y-5 rounded-xl border bg-card p-6 shadow-sm sm:p-8"
    >
      <div className="space-y-1.5 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Bid on live auctions or list something of your own.
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
        <Label htmlFor="signup-name">Display name</Label>
        <Input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Alex Rivera"
          required
          maxLength={60}
          data-testid="name-field"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          data-testid="email-field"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-describedby="signup-password-hint"
          data-testid="password-field"
        />
        <p id="signup-password-hint" className="text-xs text-muted-foreground">
          At least 8 characters.
        </p>
      </div>

      <Button type="submit" className="w-full" disabled={pending} data-testid="sign-up-button">
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
