import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

const siteUrl = SITE_URL;

/**
 * Public marketplace surfaces are crawlable; every auth-gated surface
 * (mirrored by `robots: { index: false }` in each page's metadata) is
 * disallowed here so crawlers never see a login redirect as content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/dashboard", "/notifications", "/sell", "/settings"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
