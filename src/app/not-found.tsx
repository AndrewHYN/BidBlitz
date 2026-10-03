import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

/**
 * Metadata for the router-level not-found.
 *
 * Two things need to be true for a 404, and this file is the only place both
 * can come from:
 *
 *   1. It must not inherit the homepage's `<title>` and `<meta
 *      name="description">`. An HTTP 404 carrying the site's marketing copy is
 *      a soft-404 to a crawler, and a page that does not exist should never
 *      advertise what the homepage advertises.
 *   2. It must be explicitly `noindex`. "Index, follow" is the crawler default,
 *      so leaving it unset means a 404 can be indexed. Measured against the
 *      live site before this export existed: `/nope` answered 404 with the
 *      homepage title, the homepage description, and no robots directive.
 *
 * When `src/proxy.ts` rewrote a missing auction or profile here it set
 * `x-bidblitz-missing`, and the resource-specific title came from the root
 * layout. A `metadata` export in this file takes precedence over the root
 * layout for the not-found render, so the header is read here instead — one
 * place decides all three cases, and the proxy's existing mechanism is reused
 * rather than replaced. The proxy strips any inbound copy of that header, so a
 * client cannot spoof a title or a directive.
 */
export async function generateMetadata(): Promise<Metadata> {
  const missing = (await headers()).get("x-bidblitz-missing");
  const title =
    missing === "auction"
      ? "Auction not found"
      : missing === "profile"
        ? "Profile not found"
        : "Page not found";

  return {
    title,
    description: "That page does not exist on BidBlitz.",
    robots: { index: false, follow: false },
  };
}

export default function NotFound() {
  return (
    <div
      data-testid="not-found-page"
      className="page-container flex min-h-[70vh] flex-col items-center justify-center py-16 text-center"
    >
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />
      <div className="relative flex flex-col items-center gap-4">
        <BrandMark size={56} alt="BidBlitz" />
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">404</p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          This page went unsold
        </h1>
        <p className="max-w-md text-sm text-muted-foreground text-balance">
          <SearchX className="mr-1 inline size-4" aria-hidden />
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/browse">Browse auctions</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
