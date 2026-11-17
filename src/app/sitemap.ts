import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { CANONICAL_SITE_URL as SITE_URL } from "@/lib/site-url";

const siteUrl = SITE_URL;

// Current direct-sale listings reflect the live database, not the build snapshot.
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

/** Only available direct-sale listings belong in the public sitemap at launch. */
const OPEN_STATUSES = ["LISTED"] as const;

/** Per-priority cap: the sitemap must not become a dump of thin listings. */
const MAX_OPEN = 400;

/** RLS and explicit status filters exclude drafts, closed records and auctions. */
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
