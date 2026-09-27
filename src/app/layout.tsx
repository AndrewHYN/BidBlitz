import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SITE_URL } from "@/lib/site-url";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const siteUrl = SITE_URL;

const baseMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "BidBlitz — live auctions, honest settlement",
    template: "%s · BidBlitz",
  },
  description:
    "BidBlitz is a live auction marketplace: sellers list items with a real closing time, buyers compete bid by bid, and one transparent platform fee applies to sold auctions.",
  openGraph: {
    type: "website",
    siteName: "BidBlitz",
    title: "BidBlitz — live auctions, honest settlement",
    description:
      "Live auctions with real closing times: list an item, bid against other buyers in real time, and win when the clock runs out.",
    url: siteUrl,
  },
  twitter: { card: "summary_large_image", title: "BidBlitz", description: "Live competitive auctions." },
  // Deliberately NO `robots: { index: true, follow: true }` here: "index,
  // follow" is already the crawler default, and emitting it from the root
  // layout once meant a streamed 404 carried BOTH that tag and the page-level
  // `noindex` — a conflicting directive crawlers are told to resolve
  // unpredictably. Missing resources get their explicit `noindex` below.
};

/**
 * Root metadata resolves per request for exactly one reason: `src/proxy.ts`
 * sets `x-bidblitz-missing` when it rewrites a missing auction/profile URL
 * onto the router-level not-found path, and that response needs a
 * resource-specific title plus an explicit `noindex`. `not-found.tsx` cannot
 * export metadata (verified against the live build), so the root layout is the
 * only place both can come from — and the proxy strips any inbound copy of the
 * header, so a client cannot spoof the directive onto a real page.
 *
 * With no header set, this returns the same object the previous static export
 * was, so no normal page's head changes.
 */
export async function generateMetadata(): Promise<Metadata> {
  const missing = (await headers()).get("x-bidblitz-missing");
  if (missing === "auction" || missing === "profile") {
    return {
      ...baseMetadata,
      title: {
        default: missing === "auction" ? "Auction not found" : "Profile not found",
        template: "%s · BidBlitz",
      },
      robots: { index: false, follow: false },
    };
  }
  return baseMetadata;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Seed the client clock from request time. This is a Server Component, which
  // renders exactly once per request, so `Date.now()` here is deterministic in
  // the way the purity rule exists to guarantee. (The rule still applies to
  // client components, which re-render — ClockProvider only ever ticks from an
  // external interval there.)
  // eslint-disable-next-line react-hooks/purity -- server component: one render per request
  const serverTimeMs = Date.now();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers serverTimeMs={serverTimeMs}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
