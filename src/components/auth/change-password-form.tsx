"use client";

import { useRef, useState, useTransition } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { changePasswordAction } from "@/server/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Security → Change password for an already-authenticated user.
 *
 * This is the normal-session counterpart to the recovery form, not a reuse
 * of it: the caller is signed in (Settings gates on `getUser()`), the
 * session survives the change, and a missing session means "sign in again"
 * rather than "request a new reset link". No current-password field — GoTrue
 * does not verify one for an authenticated `updateUser`, so asking would be
 * theater rather than security.
 */
export function ChangePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const busyRef = useRef(false);

  const meetsLength = newValue.length >= MIN_PASSWORD_LENGTH;
  const matches = newValue.length > 0 && newValue === confirmValue;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;

    setError(null);
    setDone(false);
    if (newValue.length < MIN_PASSWORD_LENGTH) {
      busyRef.current = false;
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newValue !== confirmValue) {
      busyRef.current = false;
      setError("Those two passwords do not match.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await changePasswordAction({ password: newValue });
        if (result.ok) {
          setDone(true);
          setNewValue("");
          setConfirmValue("");
          toast.success("Password changed. You stay signed in.");
          return;
        }
        setError(result.rejection.message);
      } catch {
        setError("We couldn't change your password. Please try again.");
      } finally {
        busyRef.current = false;
      }
    });
  }

  return (
    <section
      aria-labelledby="security-heading"
      className="space-y-5 border-t border-border/70 pt-8"
    >
      <div className="space-y-1">
        <h2 id="security-heading" className="text-base font-semibold tracking-tight">
          Security
        </h2>
        <p className="text-sm text-muted-foreground">
          Change the password you sign in with. You stay signed in on this
          device afterwards.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        method="post"
        className="space-y-5"
        data-testid="change-password-form"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="change-new-password">New password</Label>
          <div className="relative">
            <Input
              id="change-new-password"
              name="password"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              data-testid="change-new-password-field"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              aria-label={showNew ? "Hide new password" : "Show new password"}
              aria-pressed={showNew}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
            >
              {showNew ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            At least {MIN_PASSWORD_LENGTH} characters.
            {newValue.length > 0 &&
              (meetsLength ? " Length looks good." : " Keep going.")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="change-confirm-password">Confirm new password</Label>
          <div className="relative">
            <Input
              id="change-confirm-password"
              name="confirm"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              data-testid="change-confirm-password-field"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              aria-label={showConfirm ? "Hide confirmation" : "Show confirmation"}
              aria-pressed={showConfirm}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
            >
              {showConfirm ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
          {confirmValue.length > 0 && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {matches ? "Passwords match." : "Passwords do not match yet."}
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            data-testid="change-password-error"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {done && !error && (
          <p
            role="status"
            data-testid="change-password-done"
            className="flex items-center gap-2 rounded-lg border border-live/30 bg-live/10 px-3 py-2 text-sm text-live"
          >
            <ShieldCheck className="size-4" aria-hidden />
            Password changed. Sign out and back in any time to confirm it.
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={pending}
          aria-busy={pending}
          data-testid="change-password-button"
        >
          {pending ? "Changing…" : "Change password"}
        </Button>
      </form>
    </section>
  );
}
