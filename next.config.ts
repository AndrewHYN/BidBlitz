import type { NextConfig } from "next";

/**
 * `next/image` may only optimise hosts that are listed here.
 *
 * The one host BidBlitz serves user-supplied images from is Supabase Storage,
 * read from the same environment variable the app already uses everywhere else
 * — deliberately not hard-coded, so pointing the project at a different
 * Supabase project (or the test project, see docs/POST_LAUNCH_BACKLOG.md)
 * needs no code change.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  async redirects() {
    return ["bidblitz.co.zw", "bid-blitz-ten.vercel.app"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: "https://www.bidblitz.co.zw/:path*",
      permanent: true,
    }));
  },
  images: {
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: "https",
            hostname: new URL(supabaseUrl).hostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
