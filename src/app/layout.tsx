import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "BidBlitz — live auctions, honest settlement",
    template: "%s · BidBlitz",
  },
  description:
    "A competitive auction marketplace with server-authoritative bidding, anti-snipe protection, live updates and transparent fees.",
  openGraph: {
    type: "website",
    siteName: "BidBlitz",
    title: "BidBlitz — live auctions, honest settlement",
    description:
      "Bid on live auctions with real-time updates, anti-snipe protection and transparent fees.",
    url: siteUrl,
  },
  twitter: { card: "summary_large_image", title: "BidBlitz", description: "Live competitive auctions." },
  robots: { index: true, follow: true },
};

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
