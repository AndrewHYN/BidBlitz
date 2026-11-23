"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setServiceAvailabilityAction } from "@/server/actions/auction";

type Availability = "AVAILABLE" | "BUSY" | "UNAVAILABLE";

const descriptions: Record<Availability, string> = {
  AVAILABLE: "Clients can send new service requests.",
  BUSY: "Your service stays visible. Clients can still request work, so set expectations for a later start.",
  UNAVAILABLE: "Your service stays visible, but new service requests and contact actions are hidden. Existing conversations remain available.",
};

export function ServiceAvailabilityControl({ listingId, initialAvailability }: {
  listingId: string;
  initialAvailability: Availability;
}) {
  const [availability, setAvailability] = useState<Availability>(initialAvailability);
  const [savedAvailability, setSavedAvailability] = useState<Availability>(initialAvailability);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    startTransition(async () => {
      try {
        const result = await setServiceAvailabilityAction({ listingId, availability });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        setSavedAvailability(result.availability);
        toast.success(result.availability === "UNAVAILABLE" ? "Service marked unavailable" : "Service availability updated");
        router.refresh();
      } catch {
        toast.error("Could not update your service availability. Please try again.");
      }
    });
  }

  return (
    <section aria-label="Service availability" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Service availability</h2>
        <p className="text-sm text-muted-foreground">Pause new enquiries without removing the listing or losing reviews.</p>
      </div>
      <label htmlFor="service-availability" className="block text-sm font-semibold">Current availability</label>
      <select
        id="service-availability"
        data-testid="service-availability"
        className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        value={availability}
        onChange={(event) => setAvailability(event.target.value as Availability)}
        disabled={pending}
      >
        <option value="AVAILABLE">Available — accepting requests</option>
        <option value="BUSY">Busy — accepting future work</option>
        <option value="UNAVAILABLE">Unavailable — no new requests</option>
      </select>
      <p className="text-xs leading-5 text-muted-foreground" role="status">{descriptions[availability]}</p>
      <Button type="button" onClick={save} disabled={pending || availability === savedAvailability} className="min-h-11">
        {pending ? "Saving…" : "Save availability"}
      </Button>
    </section>
  );
}
