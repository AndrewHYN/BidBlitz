"use client";

import { useState, useTransition } from "react";
import { updatePreferencesAction } from "@/server/actions/preferences";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Email preferences: the OPTIONAL mail a user may silence. Critical mail
 * (security, money, wins, cancellations, moderation decisions) is not listed
 * here because it cannot be disabled - losing a "you won" email to an
 * unchecked box would be a failure, not a preference.
 */
const OPTIONAL = [
  {
    key: "outbid",
    title: "Outbid alerts",
    description: "An email when someone tops your bid.",
  },
  {
    key: "ending_soon",
    title: "Ending soon",
    description: "An email when an auction you bid on nears its close.",
  },
  {
    key: "marketplace_activity",
    title: "Marketplace activity",
    description: "Occasional new listings and product news. Off unless you ask.",
  },
] as const;

export function EmailPreferences({
  initial,
}: {
  initial: { outbid: boolean; ending_soon: boolean; marketplace_activity: boolean };
}) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(key: keyof typeof initial, next: boolean) {
    setSaved(false);
    setError(null);
    const updated = { ...values, [key]: next };
    setValues(updated);
    startTransition(async () => {
      try {
        const result = await updatePreferencesAction(updated);
        if (!result.ok) {
          setError(result.message);
          setValues(values);
          return;
        }
        setSaved(true);
      } catch {
        setError("We couldn't save that. Please try again.");
        setValues(values);
      }
    });
  }

  return (
    <section aria-labelledby="email-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="email-heading" className="text-base font-semibold tracking-tight">
          Email notifications
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose the optional mail. Security, payment, win, cancellation and
          moderation emails always arrive.
        </p>
      </div>
      <ul className="space-y-3">
        {OPTIONAL.map((item) => (
          <li
            key={item.key}
            className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4"
          >
            <div className="space-y-0.5">
              <Label htmlFor={`email-pref-${item.key}`}>{item.title}</Label>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
            <Switch
              id={`email-pref-${item.key}`}
              checked={values[item.key]}
              disabled={pending}
              onCheckedChange={(next) => toggle(item.key, next)}
              aria-label={item.title}
            />
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          Saved.
        </p>
      )}
    </section>
  );
}
