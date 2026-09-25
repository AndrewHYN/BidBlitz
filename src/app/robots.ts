import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
