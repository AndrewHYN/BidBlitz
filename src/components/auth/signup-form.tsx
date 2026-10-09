"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import { resendConfirmationAction, signUpAction } from "@/server/actions/auth";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { useMounted } from "@/hooks/use-mounted";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { BrandMark } from "@/components/brand-mark";
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
  // `isPending` from `useTransition` deliberately does NOT gate the button: a
  // transition update is not flushed synchronously, so a fast double-click can
  // land a second submit before the first re-render disables the control. Two
  // parallel sign-ups waste provider quota, can create a duplicate profile
  // race, and are the easiest way to manufacture our own "too many attempts".
  // `submitting` is an ordinary state update — flushed before the browser
  // processes the next discrete event — and `busyRef` closes the same-tick
  // window outright. One click, one request.
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);
  // Set only when the account was created AND email confirmation is pending.
  const [sentTo, setSentTo] = useState<string | null>(null);
  // Resend state for the confirmation panel below. The address is already
  // known (it is `sentTo`), so this is one button, not another form.
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  // "Has React taken over this form?" — see the identical flag on login-form.
  // Exposed so an automated submit can wait for hydration, exactly as a person
  // naturally does while typing an email and choosing a password.
  const hydrated = useMounted();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return; // duplicate submit while the first is in flight

    const data = new FormData(event.currentTarget);
    const displayName = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const phone = String(data.get("phone") ?? "").trim();

    if (!displayName) {
      setError("Enter your name.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    setError(null);
    startTransition(async () => {
      try {
        const result = await signUpAction({ email, password, displayName, phone });
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
      } finally {
        busyRef.current = false;
        setSubmitting(false);
      }
    });
  }

  async function handleResend() {
    if (!sentTo || resending) return;
    setResending(true);
    setResendError(null);
    try {
      // The action answers the same generic success for known and unknown
      // addresses (enumeration safety lives server-side), so reaching here
      // always means "check your inbox" — never an account-exists signal.
      const result = await resendConfirmationAction({ email: sentTo });
      if (!result.ok) {
        setResendError(result.rejection.message);
        return;
      }
      setResent(true);
    } catch {
      setResendError("We couldn't resend that email. Please try again.");
    } finally {
      setResending(false);
    }
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
        {resent ? (
          <p data-testid="resend-confirmation-sent" role="status" className="text-sm text-muted-foreground">
            If an account exists for <strong className="break-all text-foreground">{sentTo}</strong>,
            a fresh confirmation link is on its way.
          </p>
        ) : (
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={resending}
              aria-busy={resending}
              onClick={handleResend}
              data-testid="resend-confirmation-button"
            >
              {resending ? "Resending…" : "Didn't get the email? Resend it"}
            </Button>
            {resendError && (
              <p role="alert" className="text-sm text-destructive">
                {resendError}
              </p>
            )}
          </div>
        )}
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      /*
       * POST on purpose, for the same reason as the login form: without a
       * declared method a submit that happens before hydration is a native GET,
       * which would put the email, the password and the confirm-password into
       * the URL. Declared POST makes an un-hydrated submit fail visibly rather
       * than leak three credentials into history, logs and the next Referer.
       */
      method="post"
      data-testid="signup-form"
      data-hydrated={hydrated ? "true" : undefined}
      className="auth-card space-y-5 rounded-2xl border bg-card p-6 sm:p-8"
    >
      <div className="space-y-1.5 text-center">
        <BrandMark size={40} alt="BidBlitz" className="mx-auto" />
        <h1 className="text-xl font-semibold tracking-tight text-balance">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Bid on live auctions or list something of your own.
        </p>
      </div>

      <aside className="rounded-xl border bg-muted/30 p-3 text-sm leading-6">
        <strong>Planning to sell?</strong> You’ll connect a SmileCash wallet before creating a listing. Register on your phone with <span className="whitespace-nowrap font-mono font-semibold">*225*1#</span>, or use your existing wallet. Buyers do not need SmileCash.
      </aside>

      {error && (
        <div
          data-testid="auth-error"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <GoogleSignInButton />

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">OR</span>
        <span className="h-px flex-1 bg-border" />
      </div>

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
        <Label htmlFor="signup-phone">Mobile number</Label>
        <Input
          id="signup-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0771234567"
          required
          data-testid="phone-field"
        />
        <p className="text-xs text-muted-foreground">
          Kept private. If you sell, this becomes the starting number for your payout setup.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          aria-describedby="signup-password-hint"
          data-testid="password-field"
        />
        <p id="signup-password-hint" className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <Button
        type="submit"
        size="lg"
        className="auth-primary-action w-full"
        disabled={submitting}
        aria-busy={submitting}
        data-testid="sign-up-button"
      >
        {submitting ? "Creating account…" : "Create account"}
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
