"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNotificationsReadAction } from "@/server/actions/social";
import { Button } from "@/components/ui/button";

/**
 * Per-row "mark read". The accessible name spells out WHICH notification is
 * being dismissed, because a list of identical "Mark read" buttons is
 * unusable with a screen reader.
 */
export function MarkReadButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Mark “${label}” as read`}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await markNotificationsReadAction({ ids: [id] });
              if (!result.ok) setError(result.rejection.message);
              else router.refresh();
            } catch {
              setError("Something went wrong. Please try again.");
            }
          });
        }}
      >
        {pending ? "Marking…" : "Mark read"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
