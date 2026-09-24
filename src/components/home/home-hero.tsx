"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Home hero. The only animated block on the page — a plain GET form so the
 * very first search needs no client-side routing, and motion that stands down
 * for visitors who asked their OS for reduced motion.
 */
export function HomeHero() {
  const reduceMotion = useReducedMotion();

  return (
    <section
      data-testid="home-hero"
      className="relative overflow-hidden rounded-2xl border bg-card"
    >
      <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative px-6 py-12 sm:px-10 sm:py-16"
      >
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">
          Live auctions · honest settlement
        </p>
        <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          Bid live. Win the deal.
        </h1>
        <p className="mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
          Real-time bidding with server-authoritative pricing, anti-snipe
          protection and transparent fees — no surprises when the hammer falls.
        </p>

        {/* Plain GET form: the first search works before any JS hydrates. */}
        <form action="/browse" method="get" className="mt-6 flex w-full max-w-xl gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Label htmlFor="home-q" className="sr-only">
              Search auctions
            </Label>
            <Input
              id="home-q"
              name="q"
              type="search"
              data-testid="home-search"
              placeholder="Search sneakers, cameras, collectibles…"
              autoComplete="off"
              className="h-10 pr-3 pl-9"
            />
          </div>
          <Button type="submit" size="lg">
            Search
          </Button>
        </form>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button asChild variant="secondary">
            <Link href="/sell">
              <ArrowRight aria-hidden />
              Start selling
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/browse">Browse everything</Link>
          </Button>
        </div>
      </motion.div>
    </section>
  );
}
