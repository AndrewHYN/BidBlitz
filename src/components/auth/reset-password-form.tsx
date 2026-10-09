"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { updatePasswordAction } from "@/server/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Choose a new password" — step two, reached only through an emailed link.
 *
 * `linkState` comes from the server, which has actually asked the session
 * whether it holds a recovery grant. That distinction matters: an expired or
 * already-used link must be *explained*, not shown as an empty form that fails
 * on submit. Telling someone their link is dead is the difference between them
 * requesting a new one and them concluding the site is broken.
 *
 * On success the recovery session is spent — Supabase invalidates it once the
 * password changes — so the user is sent to sign in rather than left on a page
 * whose session no longer exists.
 */
export function ResetPasswordForm({
  linkState,
}: {
  linkState: "valid" | "invalid";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busyRef = useRef(false);

  if (linkState === "invalid") {
    return (
      <div className="space-y-5 text-center" data-testid="reset-link-invalid">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            This link has expired
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Reset links work once and only last a short time. Ask for a new one
            and it will arrive in a moment.
          </p>
        </div>
        <div className="space-y-2">
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-5 text-center" data-testid="reset-done" role="status">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-live/10 text-live">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Password updated</h1>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Your new password is live. Sign in with it. The link you used is no
            longer valid.
          </p>
        </div>
        <Button className="w-full" onClick={() => router.push("/login")}>
          Sign in
        </Button>
      </div>
    );
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;

    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      busyRef.current = false;
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      busyRef.current = false;
      setError("Those two passwords do not match.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await updatePasswordAction({ password });
        if (result.ok) {
          setDone(true);
          toast.success("Password updated.");
          return;
        }
        setError(result.rejection.message);
        // A dead link is a state, not a typo: send the user where they can fix
        // it instead of leaving them to guess.
        if (result.rejection.code === "reset_link_invalid") {
          setTimeout(() => router.push("/forgot-password"), 1800);
        }
      } catch {
        setError("We couldn't update your password. Please try again.");
      } finally {
        busyRef.current = false;
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      className="space-y-5"
      data-testid="reset-password-form"
      noValidate
    >
      <div className="mb-6 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Choose a new password</h1>
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          Pick something you have not used here before.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          data-testid="new-password-field"
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          data-testid="confirm-password-field"
        />
      </div>

      {error && (
        <p
          role="alert"
          data-testid="reset-password-error"
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
        data-testid="update-password-button"
      >
        {pending ? "Updating…" : "Update password"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
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
