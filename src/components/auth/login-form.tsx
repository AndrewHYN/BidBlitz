"use client";

import Link from "next/link";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, UserRoundPlus } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { signInAction, requestEmailLoginCodeAction, verifyEmailLoginCodeAction } from "@/server/actions/auth";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
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
  const [showPassword, setShowPassword] = useState(false);
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
      method="post"
      data-testid="login-form"
      data-hydrated={hydrated ? "true" : undefined}
      className="space-y-4 sm:space-y-5"
    >
      {error && mode === "password" && (
        <div data-testid="auth-error" role="alert"
          className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {mode === "password" ? (
        <>
          <GoogleSignInButton next={redirectTo} />

          <div className="flex items-center gap-3 py-1" aria-hidden="true">
            <span className="h-px flex-1 bg-[#50637F]/60" />
            <span className="shrink-0 text-xs text-slate-400">or sign in with email</span>
            <span className="h-px flex-1 bg-[#50637F]/60" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-email" className="gap-2 text-sm font-semibold text-slate-100">
              <Mail className="size-4 text-amber-300" aria-hidden /> Email
            </Label>
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

          <div className="space-y-2">
            <Label htmlFor="login-password" className="gap-2 text-sm font-semibold text-slate-100">
              <LockKeyhole className="size-4 text-amber-300" aria-hidden /> Password
            </Label>
            <div className="relative">
              <Input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="pr-14"
                data-testid="password-field"
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 inline-flex min-w-12 items-center justify-center rounded-r-xl text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-amber-400"
                data-testid="toggle-password-visibility"
              >
                {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="login-primary-action h-12 w-full gap-2 rounded-xl font-bold sm:h-14"
            disabled={submitting}
            aria-busy={submitting}
            data-testid="sign-in-button"
          >
            {submitting ? "Signing in…" : <>Sign in <ArrowRight className="size-4" aria-hidden /></>}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="login-secondary-action h-12 w-full gap-2 rounded-xl font-semibold sm:h-14"
            onClick={switchToOtp}
            data-testid="otp-toggle-button"
          >
            <Mail className="size-4" aria-hidden /> Email me a sign-in code
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

      <div className="pt-1 text-center text-sm">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-10 items-center justify-center text-slate-300 underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          Forgot your password?
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-[#526685]/45 pt-5 text-center text-sm">
        <UserRoundPlus className="size-4 text-amber-300" aria-hidden />
        <span className="text-slate-300">New to BidBlitz?</span>
        <Link
          href="/signup"
          className="inline-flex min-h-10 items-center gap-1 font-bold text-[#FFB648] underline-offset-4 hover:text-[#FFD18D] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          Create an account <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
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
      <div className="space-y-2">
        <p className="text-sm leading-6 text-slate-300">Get a one-time code in your email instead of using a password.</p>
        <Label htmlFor="otp-email" className="text-slate-100">Email</Label>
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
          className="login-primary-action h-12 w-full rounded-xl font-bold"
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
          <div className="space-y-2">
            <Label htmlFor="otp-code" className="text-slate-100">6-digit code</Label>
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
            className="login-primary-action h-12 w-full rounded-xl font-bold"
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
          className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
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
