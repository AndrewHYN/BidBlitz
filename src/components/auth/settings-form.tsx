"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signOutAction, updateProfileAction } from "@/server/actions/auth";
import { profileSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

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

const BIO_MAX = 500;

export function SettingsForm({
  email,
  initial,
}: {
  email: string;
  initial: { displayName: string; bio: string; location: string };
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [location, setLocation] = useState(initial.location);
  const [bio, setBio] = useState(initial.bio);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = profileSchema.safeParse({ displayName, bio, location });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProfileAction(parsed.data);
        if (result.ok) {
          toast.success("Settings saved.");
          router.refresh();
        } else {
          setError(result.rejection.message);
        }
      } catch (err) {
        if (isNextRedirect(err)) throw err;
        setError("Couldn't save your settings. Please try again.");
      }
    });
  }

  function handleSignOut() {
    setSigningOut(async () => {
      try {
        await signOutAction();
      } catch (err) {
        if (isNextRedirect(err)) throw err; // signed out — router is navigating
        toast.error("Couldn't sign out. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        data-testid="settings-form"
        className="space-y-5 rounded-xl border bg-card p-5 sm:p-6"
      >
        {error && (
          <div
            data-testid="settings-error"
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="settings-display-name">Display name</Label>
          <Input
            id="settings-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            maxLength={60}
            required
            data-testid="display-name-field"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-location">Location</Label>
          <Input
            id="settings-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            autoComplete="address-level2"
            placeholder="City, State"
            maxLength={80}
            data-testid="location-field"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="settings-bio">Bio</Label>
            <span
              className="text-xs text-muted-foreground tabular-nums"
              aria-hidden
            >
              {bio.length}/{BIO_MAX}
            </span>
          </div>
          <Textarea
            id="settings-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            maxLength={BIO_MAX}
            rows={4}
            placeholder="Tell buyers a bit about yourself."
            aria-describedby="settings-bio-count"
            data-testid="bio-field"
          />
          <p id="settings-bio-count" className="sr-only">
            {bio.length} of {BIO_MAX} characters used
          </p>
        </div>

        <Button type="submit" className="w-full" disabled={pending} data-testid="save-settings-button">
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <div className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Account</h2>
          <p className="text-xs text-muted-foreground">
            Your sign-in credentials. Changing your email isn&apos;t available yet.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settings-email">Email</Label>
          <Input id="settings-email" value={email} readOnly />
        </div>

        <Separator />

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleSignOut}
          disabled={signingOut}
          data-testid="sign-out-button"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}
