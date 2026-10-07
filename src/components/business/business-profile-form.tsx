"use client";

import { useState, useTransition } from "react";
import { Building2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveBusinessProfileAction } from "@/server/actions/business";

export function BusinessProfileForm({
  initial,
}: {
  initial: {
    displayName: string;
    description: string;
    location: string;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      method="post"
      className="business-profile-surface space-y-5 rounded-2xl border p-5 shadow-sm sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setMessage(null);
        startTransition(async () => {
          const result = await saveBusinessProfileAction({
            displayName: String(data.get("displayName") ?? ""),
            description: String(data.get("description") ?? ""),
            location: String(data.get("location") ?? ""),
          });
          setMessage(result.ok ? "Business storefront saved." : result.message);
        });
      }}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Building2 className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-bold">Business seller profile</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            This is a public storefront identity for listings you choose to sell as a business.
            It is not a BidBlitz verification badge.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="business-display-name">Business name</Label>
        <Input
          id="business-display-name"
          name="displayName"
          defaultValue={initial.displayName}
          maxLength={80}
          placeholder="Electro Sales"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="business-description">About the business</Label>
        <Textarea
          id="business-description"
          name="description"
          defaultValue={initial.description}
          rows={5}
          maxLength={1200}
          placeholder="What your business sells, what buyers can expect, and any useful public information."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="business-location">Business location</Label>
        <div className="relative">
          <MapPin
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="business-location"
            name="location"
            defaultValue={initial.location}
            maxLength={120}
            placeholder="Harare"
            className="pl-9"
          />
        </div>
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving storefront…" : "Save business profile"}
      </Button>
      {message && (
        <p role="status" className="text-sm leading-6 text-muted-foreground">
          {message}
        </p>
      )}
    </form>
  );
}
