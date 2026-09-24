"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { markAllNotificationsReadAction } from "@/server/actions/social";
import { Button } from "@/components/ui/button";

/**
 * One click clears the unread set. The action revalidates `/notifications`,
 * so the refreshed server render is the source of truth — no optimistic
 * "read" state that could disagree with the database.
 */
export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="mark-all-read"
        disabled={disabled || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await markAllNotificationsReadAction();
              if (!result.ok) setError(result.rejection.message);
              else router.refresh();
            } catch {
              setError("Something went wrong. Please try again.");
            }
          });
        }}
      >
        <Check aria-hidden />
        {pending ? "Marking…" : "Mark all read"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
