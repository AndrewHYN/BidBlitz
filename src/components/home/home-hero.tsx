"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Clock3,
  Gavel,
  MapPinned,
  MessageCircle,
  Search,
  ShieldCheck,
  Wallet,
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
    {
      icon: Wallet,
      label: "Confirmed payments",
      detail: "A sale is marked paid only once the provider confirms it.",
    },
    {
      icon: MessageCircle,
      label: "Private post-sale chat",
      detail: "Buyer and seller get a transaction-linked thread after a win.",
    },
    {
      icon: MapPinned,
      label: "Safer handovers",
      detail: "Agree collection clearly and use a public meeting place when practical.",
    },
  ];

  return (
    <section data-testid="home-hero" className="relative isolate overflow-hidden rounded-[1.75rem] border border-orange-400/20 bg-[#141719] px-5 py-8 text-white shadow-[0_25px_90px_-35px_rgba(0,0,0,.65)] sm:px-10 sm:py-12 lg:px-14">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.11]"
        style={{backgroundImage:"linear-gradient(90deg,transparent 97%,#f5a35a 97%),linear-gradient(transparent 97%,#f5a35a 97%)",backgroundSize:"52px 52px"}}/>
      <div aria-hidden className="pointer-events-none absolute -right-28 -top-52 size-[36rem] rounded-full border-[5rem] border-orange-500/5"/>
      <div className="relative z-10 mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4 text-[10px] font-black uppercase tracking-[.22em] text-zinc-400">
        <span>BIDBLITZ / MARKETPLACE 001</span><span>HUMAN SELLERS. REAL BIDS.</span>
      </div>
      <div className="relative z-10 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)] lg:items-center lg:gap-16">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, x: -12 }}
          animate={reduceMotion ? undefined : { opacity: 1, x: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="min-w-0"
        >
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.2em] text-orange-300">
            <span className="h-px w-7 bg-orange-300" aria-hidden />
            Live online auctions in Zimbabwe
          </div>

          <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[.96] tracking-[-.065em] text-balance sm:text-7xl xl:text-[5.7rem]">
            Bid live.
            <br />
            <span className="text-orange-300">Win the deal.</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-8 text-zinc-300 sm:text-lg">
            Find the item, watch the clock and bid with confidence. Sellers set
            the terms up front; the highest valid bid when the server closes the
            auction wins.
          </p>

          <form
            action="/browse"
            method="get"
            className="mt-8 flex w-full max-w-2xl gap-2 rounded-xl border border-white/15 bg-white/[.055] p-2 shadow-inner"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-orange-300"
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
                className="h-11 border-white/15 bg-[#202427] pl-9 pr-3 text-white placeholder:text-zinc-400 focus-visible:ring-orange-300"
              />
            </div>
            <Button type="submit" size="lg" className="min-h-11 rounded-lg bg-orange-500 text-[#17191b] shadow-lg hover:bg-orange-300">
              Search
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button asChild size="lg" className="rounded-lg bg-orange-500 font-extrabold text-[#17191b] shadow-lg shadow-orange-900/20 transition hover:-translate-y-0.5 hover:bg-orange-300">
              <Link href="/browse">
                Browse live auctions
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-lg border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white">
              <Link href="/sell">Sell an item</Link>
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
          className="rounded-2xl border border-white/15 bg-white/[.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] sm:p-7"
          aria-label="How BidBlitz works"
        >
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[.15em] text-orange-300">
            <Gavel className="size-4 text-orange-300" aria-hidden />
            <Link
              href="/how-it-works"
              className="underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
            >
              Built for real auctions
            </Link>
          </div>

          <div className="mt-5 space-y-1.5">
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
                className="group flex gap-3 rounded-xl border border-transparent px-2 py-2.5 transition-colors hover:border-white/10 hover:bg-white/5"
              >
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-orange-400/20 bg-orange-500/10 text-orange-300 transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{label}</p>
                  <p className="mt-1 text-xs leading-6 text-zinc-400">
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
