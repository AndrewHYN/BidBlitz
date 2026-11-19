"use client";

import { useActionState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketplaceLocationField } from "@/components/home/marketplace-location-field";
import { setHomeLocation, saveSignupLocation } from "@/server/actions/marketplace-location";

export function HomeLocationPicker({ location, defaultLocation }: { location: string | null; defaultLocation: string }) {
  const [error, action, pending] = useActionState(setHomeLocation, null);

  return (
    <details className="group/location rounded-xl border bg-card px-4 shadow-xs">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <MapPin className="size-4 text-primary" aria-hidden />
        {location ?? "All Zimbabwe"} <span className="ml-auto font-normal text-muted-foreground">Change location</span><ChevronDown className="size-4 text-muted-foreground group-open/location:rotate-180" aria-hidden />
      </summary>
      <form action={action} className="max-w-md space-y-3 pb-4">
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
