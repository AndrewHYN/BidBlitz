import type { MetadataRoute } from "next";

// Normalize away a trailing slash (the deployed env has one) so the sitemap
// reference is single-slash regardless of how the variable is formatted.
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

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
