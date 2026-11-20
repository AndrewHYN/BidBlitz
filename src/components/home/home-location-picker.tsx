"use client";

import { useActionState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HomeFilterPanel } from "@/components/home/home-filter-panel";
import { MarketplaceLocationField } from "@/components/home/marketplace-location-field";
import { setHomeLocation, saveSignupLocation } from "@/server/actions/marketplace-location";

export function HomeLocationPicker({ location, defaultLocation }: { location: string | null; defaultLocation: string }) {
  const [error, action, pending] = useActionState(setHomeLocation, null);

  return (
    <>
      <Button type="button" variant="outline" size="icon" popoverTarget="home-location-panel" aria-haspopup="dialog"
        aria-label={`Change location, currently ${location ?? "All Zimbabwe"}`} title={`Change location · ${location ?? "All Zimbabwe"}`}>
        <MapPin className="size-5" aria-hidden />
      </Button>
      <HomeFilterPanel id="home-location-panel" title="Listing location">
        <form action={action} className="space-y-3">
          <MarketplaceLocationField id="home-location" initial={location ?? defaultLocation} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>Show listings here</Button>
            <Button type="submit" variant="outline" name="scope" value="national" formNoValidate disabled={pending}>All Zimbabwe</Button>
          </div>
        </form>
      </HomeFilterPanel>
    </>
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
