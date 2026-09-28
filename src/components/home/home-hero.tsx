"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Clock3,
  Gavel,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Editorial home hero: the proposition and search stay dominant, while the
 * right side explains the actual mechanics of BidBlitz instead of filling the
 * space with decorative KPI cards or fabricated activity.
 */
export function HomeHero() {
  const reduceMotion = useReducedMotion();

  const signals = [
    {
      icon: Clock3,
      label: "Real closing times",
      detail: "The server decides when an auction ends.",
    },
    {
      icon: Zap,
      label: "Live competition",
      detail: "Bids update as the auction moves.",
    },
    {
      icon: ShieldCheck,
      label: "Straightforward fees",
      detail: "Sellers pay 5% when an auction sells.",
    },
  ];

  return (
    <section data-testid="home-hero" className="relative border-y py-8 sm:py-12">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] lg:items-center lg:gap-16">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, x: -12 }}
          animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="min-w-0"
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            <span className="h-px w-6 bg-primary" aria-hidden />
            Live competitive auctions
          </div>

          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance sm:text-6xl">
            Bid live.
            <br />
            <span className="text-primary">Win the deal.</span>
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            List an item, set the closing time and let buyers compete. The
            highest valid bid when the clock runs out wins.
          </p>

          <form
            action="/browse"
            method="get"
            className="mt-7 flex w-full max-w-2xl gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
                placeholder="Search cameras, sneakers, consoles…"
                autoComplete="off"
                className="h-11 pr-3 pl-9"
              />
            </div>
            <Button type="submit" size="lg">
              Search
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary">
              <Link href="/sell">
                Start selling
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/browse">Browse auctions</Link>
            </Button>
          </div>
        </motion.div>

        <motion.aside
          initial={reduceMotion ? false : { opacity: 0, x: 12 }}
          animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
          transition={{
            duration: 0.42,
            delay: reduceMotion ? 0 : 0.06,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="border-l border-primary/20 pl-5 sm:pl-7"
          aria-label="How BidBlitz works"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gavel className="size-4 text-primary" aria-hidden />
            How the blitz works
          </div>

          <div className="mt-5 space-y-5">
            {signals.map(({ icon: Icon, label, detail }, index) => (
              <motion.div
                key={label}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{
                  duration: 0.28,
                  delay: reduceMotion ? 0 : 0.1 + index * 0.06,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="group flex gap-3"
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center border border-border bg-card text-primary transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {detail}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.aside>
      </div>
    </section>
  );
}
