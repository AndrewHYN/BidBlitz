"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { signInAction, requestEmailLoginCodeAction, verifyEmailLoginCodeAction } from "@/server/actions/auth";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { BrandMark } from "@/components/brand-mark";
import { useMounted } from "@/hooks/use-mounted";
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
  /*
   * Whether React has taken over this form.
   *
   * Exposed as `data-hydrated` because it is a real, observable state and
   * something genuinely needs to know about it: the automated suites submit
   * this form, and a submit that lands before hydration is now a *safe* native
   * POST (see the `method` comment below) rather than a password in the URL —
   * which is the right trade, but it means an automated submit that beats
   * hydration sees nothing happen. Without this flag, that race showed up as an
   * intermittent test failure and looked like a product bug.
   *
   * A person never hits it: typing an email and a password takes far longer
   * than the bundle takes to load. This is about making an automated submit
   * wait for the same thing a person naturally waits for.
   */
  const hydrated = useMounted();
  // See signup-form.tsx: `isPending` from `useTransition` is not synchronous,
  // so it cannot be what disables the button. `submitting` + `busyRef` make a
  // double-click a single sign-in request — repeated duplicate submissions are
  // exactly what turns an ordinary sign-in into a self-inflicted rate limit.
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Passwordless mode is a view over the same form, not a second form:
  // password login stays primary and untouched. `otpEmail` carries the typed
  // address across the switch so nobody retypes it; `otpSent` flips the view
  // from "send the code" to "enter the code".
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [otpEmail, setOtpEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const otpBusyRef = useRef(false);

  function switchToOtp() {
    const email = String(
      new FormData(formRef.current ?? undefined).get("email") ?? ""
    );
    setOtpEmail(email);
    setOtpSent(false);
    setError(null);
    setMode("otp");
  }

  function backToPassword() {
    setMode("password");
    setOtpSent(false);
    setError(null);
  }

  function resendFromForm() {
    const email = String(
      new FormData(formRef.current ?? undefined).get("email") ?? ""
    );
    startTransition(() => {
      void runOtpRequest(email);
    });
  }

  async function runOtpRequest(email: string): Promise<boolean> {
    if (otpBusyRef.current) return false;
    otpBusyRef.current = true;
    setOtpBusy(true);
    setError(null);
    try {
      // The action answers the same generic success for known and unknown
      // addresses (enumeration safety lives server-side), so reaching here
      // always means "check your inbox" — never an account-exists signal.
      const result = await requestEmailLoginCodeAction({ email });
      if (!result.ok) {
        setError(result.rejection.message);
        return false;
      }
      setOtpEmail(email);
      setOtpSent(true);
      return true;
    } catch {
      setError("We couldn't send that code. Please try again.");
      return false;
    } finally {
      otpBusyRef.current = false;
      setOtpBusy(false);
    }
  }

  async function runOtpVerify(email: string, token: string): Promise<void> {
    if (otpBusyRef.current) return;
    otpBusyRef.current = true;
    setOtpBusy(true);
    setError(null);
    try {
      // Success ends in `redirect()`, which throws NEXT_REDIRECT — the same
      // contract as password sign-in below. A wrong code never creates one.
      const result = await verifyEmailLoginCodeAction({ email, token, redirectTo });
      if (!result.ok) setError(result.rejection.message);
    } catch (err) {
      if (isNextRedirect(err)) throw err; // signed in — let the router navigate
      setError("Sign in failed. Please try again.");
    } finally {
      otpBusyRef.current = false;
      setOtpBusy(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "otp") {
      const data = new FormData(event.currentTarget);
      const email = String(data.get("email") ?? "");
      if (!otpSent) {
        startTransition(() => {
          void runOtpRequest(email);
        });
      } else {
        const token = String(data.get("code") ?? "");
        startTransition(() => {
          void runOtpVerify(email, token);
        });
      }
      return;
    }
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
      ref={formRef}
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
      data-hydrated={hydrated ? "true" : undefined}
      className="space-y-5 rounded-xl border bg-card p-6 shadow-sm sm:p-8"
    >
      <div className="space-y-1.5 text-center">
        <BrandMark size={40} alt="BidBlitz" className="mx-auto" />
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          Welcome back
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign in to bid, sell and track your auctions.
        </p>
      </div>

      {error && mode === "password" && (
        <div
          data-testid="auth-error"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {mode === "password" ? (
        <>
          <GoogleSignInButton next={redirectTo} />

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <span className="h-px flex-1 bg-border" />
          </div>

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

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={switchToOtp}
            data-testid="otp-toggle-button"
          >
            Email me a sign-in code
          </Button>
        </>
      ) : (
        <OtpLoginView
          email={otpEmail}
          sent={otpSent}
          busy={otpBusy}
          error={error}
          onBack={backToPassword}
          onResend={resendFromForm}
        />
      )}

      <p className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Forgot your password?
        </Link>
      </p>

      <p className="text-center text-sm text-muted-foreground">
        New to BidBlitz?{" "}
        <Link
          href="/signup"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

function OtpLoginView({
  email,
  sent,
  busy,
  error,
  onBack,
  onResend,
}: {
  email: string;
  sent: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onResend: () => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="otp-email">Email</Label>
        <Input
          id="otp-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={email}
          data-testid="email-field"
        />
      </div>

      {!sent ? (
        <Button
          type="submit"
          className="w-full"
          disabled={busy}
          aria-busy={busy}
          data-testid="send-code-button"
        >
          {busy ? "Sending…" : "Send me the code"}
        </Button>
      ) : (
        <>
          <p data-testid="otp-sent-message" role="status" className="text-sm text-muted-foreground">
            If an account exists for that email, a 6-digit code is on its way.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="otp-code">6-digit code</Label>
            <Input
              id="otp-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              minLength={6}
              maxLength={6}
              pattern="[0-9]{6}"
              autoFocus
              data-testid="otp-code-field"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={busy}
            aria-busy={busy}
            data-testid="verify-code-button"
          >
            {busy ? "Verifying…" : "Verify code"}
          </Button>
        </>
      )}

      {error && (
        <div
          data-testid="auth-error"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {sent && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={onResend}
            data-testid="resend-code-button"
          >
            Send another code
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={onBack}
          data-testid="otp-back-button"
        >
          {sent ? "Use a different email" : "Back to password sign-in"}
        </Button>
      </div>
    </>
  );
}
