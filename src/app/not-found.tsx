import Link from "next/link";
import type { Metadata } from "next";
import { Gavel, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

// The custom 404 must not inherit the home page's title; verified against the
// live build after deploy.
export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you were looking for doesn't exist or has moved.",
};

export default function NotFound() {
  return (
    <div
      data-testid="not-found-page"
      className="page-container flex min-h-[70vh] flex-col items-center justify-center py-16 text-center"
    >
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-72" aria-hidden />
      <div className="relative flex flex-col items-center gap-4">
        <span className="grid size-14 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Gavel className="size-7" aria-hidden />
        </span>
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
