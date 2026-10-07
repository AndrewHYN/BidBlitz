import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SITE_URL } from "@/lib/site-url";
import { serializeJsonLd, siteStructuredData } from "@/lib/structured-data";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const siteUrl = SITE_URL;

/**
 * Site-wide defaults, deliberately NOT stating an explicit
 * `robots: { index: true, follow: true }`: "index, follow" is already the
 * crawler default, and emitting it from the root layout once meant a streamed
 * 404 carried BOTH that tag and a page-level `noindex` — a conflicting
 * directive crawlers are told to resolve unpredictably. Anything that must not
 * be indexed says so explicitly where it is rendered: see
 * `src/app/not-found.tsx` and the auction/profile pages.
 */
const baseMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Online Auctions in Zimbabwe | BidBlitz",
    template: "%s · BidBlitz",
  },
  description:
    "BidBlitz is a Zimbabwean online auction marketplace: sellers list items with a real closing time, buyers compete bid by bid, and one transparent 5% platform fee applies to sold auctions.",
  openGraph: {
    type: "website",
    siteName: "BidBlitz",
    title: "Online Auctions in Zimbabwe | BidBlitz",
    description:
      "Live online auctions in Zimbabwe with real closing times: list an item, bid against other buyers in real time, and win when the clock runs out.",
    url: siteUrl,
    images: [{ url: `${siteUrl}/brand/bidblitz-logo-512.png`, width: 512, height: 512, alt: "BidBlitz" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Online Auctions in Zimbabwe | BidBlitz",
    description: "Live competitive online auctions in Zimbabwe: bid in real time and win when the clock runs out.",
    images: [`${siteUrl}/brand/bidblitz-logo-512.png`],
  },
};

/**
 * A static export again, on purpose.
 *
 * This used to be an async `generateMetadata` that read the
 * `x-bidblitz-missing` header, set by `src/proxy.ts`, purely so a missing
 * auction or profile could be titled. It no longer needs to: a
 * `generateMetadata` export inside `src/app/not-found.tsx` takes precedence
 * over the root layout for the not-found render, and reads the same header
 * there. Leaving both would have meant two sources of truth for one title, with
 * the root copy silently dead.
 *
 * The fix this enabled is the real point. A URL that matches no route at all
 * (`/nope`) never carried that header, so it answered 404 while quietly
 * inheriting the homepage's `<title>` and `<meta name="description">` and
 * emitted no robots directive — measured against the live site on 2026-09-28.
 * A 404 advertising the homepage's marketing copy is a soft-404 to a crawler.
 * That response now gets a truthful title, a truthful description and an
 * explicit `noindex`, and the root layout no longer reads request headers on
 * every request.
 */
export const metadata: Metadata = baseMetadata;

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
      /*
       * Next.js reads this to decide whether it may keep `scroll-behavior:
       * smooth` during a route transition. globals.css sets `scroll-smooth` on
       * the html element, so without this attribute the app scrolls smoothly to
       * the top on every client-side navigation - which fights the transition
       * and made Next log a warning on every route change:
       *
       *   Detected `scroll-behavior: smooth` on the `<html>` element. To disable
       *   smooth scrolling during route transitions, add
       *   `data-scroll-behavior="smooth"` to your <html> element.
       *
       * This is the fix Next asks for, and it keeps smooth scrolling for
       * in-page anchors, which is where it is wanted.
       */
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/*
          Organization + WebSite JSON-LD, emitted once for every page. Static
          values only — no address, no founding date, no social accounts, no
          rating: see the module header in `src/lib/structured-data.ts` for why
          each of those is deliberately absent.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(siteStructuredData(siteUrl)),
          }}
        />
        <Providers serverTimeMs={serverTimeMs}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1 pb-20 md:pb-0">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
