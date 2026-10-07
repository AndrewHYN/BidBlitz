"use client";

import { useRef, useState, useTransition } from "react";
import { Building2, Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  removeBusinessLogoAction,
  uploadBusinessLogoAction,
} from "@/server/actions/business";

export function BusinessLogoUploader({
  logoUrl,
  businessName,
}: {
  logoUrl: string | null;
  businessName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentUrl, setCurrentUrl] = useState(logoUrl);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-muted">
          {currentUrl ? (
            // Public BidBlitz-managed storage URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt={businessName ? businessName + " logo" : "Business logo"}
              className="size-full object-cover"
            />
          ) : (
            <Building2 className="size-8 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Storefront logo</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Optional. JPEG, PNG, WebP or GIF up to 2 MB. A missing logo falls back to a clean business icon.
          </p>

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
              form.set("logo", file);
              setMessage(null);
              startTransition(async () => {
                const result = await uploadBusinessLogoAction(form);
                if (result.ok) {
                  setCurrentUrl(result.logoUrl);
                  setMessage("Business logo updated.");
                } else {
                  setMessage(result.message);
                }
              });
            }}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              <Camera className="size-4" aria-hidden />
              {pending ? "Uploading…" : currentUrl ? "Change logo" : "Add logo"}
            </Button>
            {currentUrl && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setMessage(null);
                  startTransition(async () => {
                    const result = await removeBusinessLogoAction();
                    if (result.ok) {
                      setCurrentUrl(null);
                      setMessage("Business logo removed.");
                    } else {
                      setMessage(result.message);
                    }
                  });
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Remove
              </Button>
            )}
          </div>

          {message && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
