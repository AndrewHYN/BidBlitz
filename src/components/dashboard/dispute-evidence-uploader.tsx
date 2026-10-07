"use client";

import { useRef, useState, useTransition } from "react";
import { ImagePlus, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadDisputeEvidenceAction } from "@/server/actions/disputes";

export function DisputeEvidenceUploader({
  disputeId,
  resolved,
}: {
  disputeId: string;
  resolved: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (resolved) return null;

  return (
    <div className="case-evidence-surface space-y-3 rounded-xl border p-4">
      <div className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <LockKeyhole className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-bold">Private evidence</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Upload up to 8 images for this case. Evidence is private to the buyer, seller and authorised BidBlitz staff.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const form = new FormData();
          form.set("disputeId", disputeId);
          form.set("evidence", file);
          setMessage(null);
          startTransition(async () => {
            const result = await uploadDisputeEvidenceAction(form);
            setMessage(result.ok ? "Evidence added to the case." : result.message);
          });
        }}
      />

      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
      >
        <ImagePlus className="size-4" aria-hidden />
        {pending ? "Uploading evidence…" : "Add evidence image"}
      </Button>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
