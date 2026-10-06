"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { requestPasswordResetAction } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "I forgot my password" — step one of two.
 *
 * The confirmation deliberately does not say whether the address has an account.
 * That is not politeness: a reset form that answers "no account with that
 * email" is an enumeration oracle, and password-reset enumeration is how
 * phishers decide who to target. The action returns success for an unknown
 * address, and this page says the same thing either way.
 *
 * The failure copy is where honesty lives instead — for OUR budget. BidBlitz's
 * own per-IP+address limit is reported truthfully ("too many attempts from this
 * device"), because that answer is identical for every address.
 *
 * The PROVIDER's throttle is deliberately NOT surfaced, and that is a real
 * trade, not an oversight. Measured against the live provider (2026-09-28), an
 * unknown address answers HTTP 200 while a real account answers HTTP 429
 * `over_email_send_rate_limit` — so showing that error would turn this form
 * into an account-enumeration oracle, which is the exact problem the copy above
 * exists to prevent. See the reasoning in requestPasswordResetAction. The user
 * therefore gets the same hedged confirmation either way, plus the "check spam,
 * then try again" line for the case where nothing arrives.
 */
export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const busyRef = useRef(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;

    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();

    setError(null);
    startTransition(async () => {
      try {
        const result = await requestPasswordResetAction({ email });
        if (result.ok) {
          setSentTo(email);
          return;
        }
        setError(result.rejection.message);
      } catch {
        setError("We couldn't send that email. Please try again.");
      } finally {
        busyRef.current = false;
      }
    });
  }

  if (sentTo) {
    return (
      <div
        data-testid="reset-email-sent"
        className="space-y-5 text-center"
        role="status"
      >
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-live/10 text-live">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            If an account exists for{" "}
            <span className="font-medium text-foreground">{sentTo}</span>, a
            reset link is on its way. It expires after a short time, so use it
            soon.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Nothing there? Check spam, then try again. A second request is safe.
          </p>
        </div>
        <div className="space-y-2">
          <Button asChild className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setSentTo(null)}
            data-testid="reset-try-another"
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      /* POST for the same reason as every other form here: an un-hydrated
         native submit would otherwise be a GET, putting the address in the
         URL. See login-form.tsx. */
      method="post"
      className="space-y-5"
      data-testid="forgot-password-form"
      noValidate
    >
      <div className="space-y-1.5">
        <BrandMark size={40} alt="BidBlitz" />
        <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          Enter the email you signed up with and we&apos;ll send you a link to
          choose a new password.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reset-email">Email</Label>
        <Input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          data-testid="reset-email-field"
        />
      </div>

      {error && (
        <p
          role="alert"
          data-testid="reset-error"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={pending}
        aria-busy={pending}
        data-testid="send-reset-link-button"
      >
        {pending ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
