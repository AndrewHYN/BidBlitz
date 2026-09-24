"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateReportStatusAction } from "@/components/dashboard/admin-actions";
import { Button } from "@/components/ui/button";

/**
 * Report triage. The buttons carry their own words as accessible names — no
 * icon-only controls on a table of text — and the row refreshes from the
 * server so the status chip can never drift from the database.
 */
export function ReportStatusControls({
  reportId,
  status,
}: {
  reportId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const open = status === "OPEN";
  const closed = status === "RESOLVED" || status === "DISMISSED";

  function setStatus(next: "REVIEWING" | "RESOLVED" | "DISMISSED") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateReportStatusAction({
          reportId,
          status: next,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        router.refresh();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  if (closed) {
    return (
      <p className="text-xs text-muted-foreground">
        {status === "RESOLVED" ? "Resolved" : "Dismissed"} — no further action.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => setStatus("REVIEWING")}
        >
          Start review
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => setStatus("RESOLVED")}
      >
        Resolve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => setStatus("DISMISSED")}
      >
        Dismiss
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
