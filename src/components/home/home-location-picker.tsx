"use client";

import { useActionState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketplaceLocationField } from "@/components/home/marketplace-location-field";
import { setHomeLocation, saveSignupLocation } from "@/server/actions/marketplace-location";

export function HomeLocationPicker({ location, defaultLocation }: { location: string | null; defaultLocation: string }) {
  const [error, action, pending] = useActionState(setHomeLocation, null);

  return (
    <details className="rounded-xl border bg-card p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        <MapPin className="mr-2 inline size-4 text-primary" aria-hidden />
        {location ?? "All Zimbabwe"} <span className="ml-2 font-normal text-muted-foreground">Change location</span>
      </summary>
      <form action={action} className="mt-4 max-w-md space-y-3">
        <MarketplaceLocationField id="home-location" initial={location ?? defaultLocation} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>Show listings here</Button>
          <Button type="submit" variant="outline" name="scope" value="national" formNoValidate disabled={pending}>All Zimbabwe</Button>
        </div>
      </form>
    </details>
  );
}

export function SignupLocationForm({ initial }: { initial: string }) {
  const [error, action, pending] = useActionState(saveSignupLocation, null);

  return (
    <form action={action} className="space-y-4">
      <MarketplaceLocationField id="account-location" initial={initial} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>Save location</Button>
    </form>
  );
}
