"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MARKETPLACE_TOWNS } from "@/lib/marketplace-location";

export function MarketplaceLocationField({ id, initial = "" }: { id: string; initial?: string }) {
  const [location, setLocation] = useState(initial);
  const [showMap, setShowMap] = useState(false);
  const town = MARKETPLACE_TOWNS.find(([name]) => name.toLowerCase() === location.trim().toLowerCase());
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.trim()}, Zimbabwe`)}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Town or suburb</Label>
      <Input id={id} name="location" list={`${id}-towns`} value={location}
        onChange={(event) => setLocation(event.target.value)}
        placeholder="e.g. Harare or Avondale" required minLength={2} maxLength={80} />
      <datalist id={`${id}-towns`}>
        {MARKETPLACE_TOWNS.map(([name]) => <option key={name} value={name} />)}
      </datalist>
      {location.trim().length >= 2 && (
        <div className="flex flex-wrap items-center gap-3">
          {town && (
            <Button type="button" variant="outline" size="sm" aria-expanded={showMap}
              onClick={() => setShowMap((visible) => !visible)}>
              <MapPin aria-hidden /> {showMap ? "Hide map" : "Preview map"}
            </Button>
          )}
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="text-sm text-primary underline underline-offset-2">Open in Maps</a>
        </div>
      )}
      {showMap && town && (
        <iframe title={`Map of ${town[0]}`} loading="lazy" referrerPolicy="no-referrer"
          className="h-48 w-full rounded-md border"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${town[2] - 0.12},${town[1] - 0.09},${town[2] + 0.12},${town[1] + 0.09}&layer=mapnik&marker=${town[1]},${town[2]}`} />
      )}
    </div>
  );
}
