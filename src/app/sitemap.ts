import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site-url";

const siteUrl = SITE_URL;

// The auction list must reflect the live database, not the build snapshot.
export const dynamic = "force-dynamic";

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
  { url: `${siteUrl}/browse`, changeFrequency: "hourly", priority: 0.9 },
  { url: `${siteUrl}/help`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${siteUrl}/help/rules`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${siteUrl}/help/fees`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${siteUrl}/terms`, changeFrequency: "yearly", priority: 0.3 },
  { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
];

/**
 * Open auctions are the SEO landing pages, so they are listed while they can
 * still be bid on. The query runs under the visitor's own session (RLS hides
 * drafts by construction); any failure falls back to the static routes rather
 * than taking the whole sitemap down.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("auctions")
      .select("id, updated_at")
      .in("status", ["LIVE", "SCHEDULED"])
      .order("updated_at", { ascending: false })
      .limit(500);

    const auctions: MetadataRoute.Sitemap = (data ?? []).map((row) => ({
      url: `${siteUrl}/auction/${row.id}`,
      lastModified: new Date(row.updated_at),
      changeFrequency: "hourly",
      priority: 0.8,
    }));

    return [...STATIC_ROUTES, ...auctions];
  } catch {
    return STATIC_ROUTES;
  }
}
