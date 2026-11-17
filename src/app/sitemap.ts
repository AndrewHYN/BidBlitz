import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { CANONICAL_SITE_URL as SITE_URL } from "@/lib/site-url";

const siteUrl = SITE_URL;

// The auction list must reflect the live database, not the build snapshot.
export const dynamic = "force-dynamic";

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
  { url: `${siteUrl}/browse`, changeFrequency: "hourly", priority: 0.9 },
  { url: `${siteUrl}/how-it-works`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${siteUrl}/for-sellers`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${siteUrl}/about`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${siteUrl}/faq`, changeFrequency: "monthly", priority: 0.6 },
  { url: `${siteUrl}/help`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${siteUrl}/help/rules`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${siteUrl}/help/fees`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${siteUrl}/terms`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${siteUrl}/safety`, changeFrequency: "monthly", priority: 0.6 },
];

/**
 * Statuses a crawler is allowed to be pointed at.
 *
 * This is an allow-list, not a deny-list, so a status this file has never heard
 * of is excluded by default rather than leaking into the sitemap. `DRAFT` is
 * already invisible through RLS, and `CANCELLED` / `PAUSED` / `PENDING_REVIEW`
 * are either withdrawn or held for review — none of them is a landing page a
 * buyer should be sent to.
 */
const OPEN_STATUSES = ["LISTED"] as const;

/** Per-priority cap: the sitemap must not become a dump of thin listings. */
const MAX_OPEN = 400;

/**
 * Two tiers, so a completed auction can never crowd a live one out of the
 * index.
 *
 * Open auctions are the SEO landing pages while they can still be bid on.
 * Completed auctions stay crawlable as historical marketplace content — a
 * listing that actually sold, or drew real bids, is a genuine record of what
 * happens on BidBlitz — but they rank below anything a visitor can act on now,
 * and an auction that ended with no bids at all is excluded as thin.
 *
 * The queries run under the visitor's own session, so RLS hides drafts by
 * construction rather than by this file remembering to filter them; any
 * failure falls back to the static routes rather than taking the sitemap down.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = await createClient();

    const open = await supabase
      .from("auctions")
      .select("id, updated_at")
      .eq("is_direct", true)
      .in("status", [...OPEN_STATUSES])
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(MAX_OPEN);

    if (open.error) console.error("[sitemap] direct listings:", open.error.message);

    const openUrls: MetadataRoute.Sitemap = (open.data ?? []).map((row) => ({
      url: `${siteUrl}/listing/${row.id}`,
      lastModified: new Date(row.updated_at),
      changeFrequency: "hourly",
      priority: 0.8,
    }));

    return [...STATIC_ROUTES, ...openUrls];
  } catch (error) {
    console.error("[sitemap]", error);
    return STATIC_ROUTES;
  }
}
