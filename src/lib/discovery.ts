import { MARKETPLACE_TOWNS } from "@/lib/marketplace-location";

type ListingTitle = { id: string; title: string };

export type SuggestedSearch = { label: string; href: string };

/** Suggestions come from live listing titles, not invented keywords or fake trending data. */
export function suggestedSearches(listings: readonly ListingTitle[], limit = 6): SuggestedSearch[] {
  const seen = new Set<string>();
  const out: SuggestedSearch[] = [];
  for (const listing of listings) {
    const label = listing.title
      .replace(/[^\p{L}\p{N}\s'’-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 5)
      .join(" ");
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push({ label, href: "/browse?q=" + encodeURIComponent(label) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Keep the true publication time visible without relying on the visitor's clock. */
export function listedAge(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const published = Date.parse(iso);
  if (!Number.isFinite(published)) return null;
  const elapsed = Math.max(0, Math.floor((now - published) / 1000));
  if (elapsed < 60) return "just now";
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : minutes + " minutes ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : hours + " hours ago";
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "1 day ago" : days + " days ago";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(published));
}

/** Only use a city for nearby results when the seller's location actually names it. */
export function knownListingTown(location: string | null | undefined): string | null {
  const locationText = location?.toLocaleLowerCase() ?? "";
  return MARKETPLACE_TOWNS.find(([town]) => locationText.includes(town.toLocaleLowerCase()))?.[0] ?? null;
}
