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

/**
 * Browser-side defense in depth. Next.js needs inline bootstrap code for its
 * current App Router renderer, so script/style inline sources remain allowed.
 * Blocking eval, foreign frames, unsafe object loads and unapproved network
 * destinations still materially reduces browser exposure.
 *
 * Content policies are not a substitute for RLS or server-side validation.
 */
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
const supabaseSocket = supabaseUrl
  ? `wss://${new URL(supabaseUrl).host}`
  : "";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src https://www.openstreetmap.org",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}`.trim(),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      { source: "/auction/:id", destination: "/listing/:id", statusCode: 301 as const },
      ...["bidblitz.co.zw", "bid-blitz-ten.vercel.app"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: "https://www.bidblitz.co.zw/:path*",
      statusCode: 301 as const,
      })),
    ];
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
