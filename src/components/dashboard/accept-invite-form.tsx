"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/server/actions/team";
import { Button } from "@/components/ui/button";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">
        Accepting binds your signed-in account to the invited role. Nothing
        changes until you confirm below.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await acceptInviteAction({ token });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.push("/admin/team");
            } catch {
              setError("That invitation link is expired, revoked or already used.");
            }
          });
        }}
      >
        {pending ? "Working…" : "Accept invitation"}
      </Button>
    </div>
  );
}
