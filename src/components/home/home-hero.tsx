import Link from "next/link";
import { MapPin, MessageCircle, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function HomeHero() {
  return (
    <section data-testid="home-hero" className="overflow-hidden rounded-2xl border border-orange-400/20 bg-[#15181b] p-6 text-white sm:p-10 lg:p-14">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,.48fr)] lg:items-end">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-orange-300">
            <MapPin className="size-4" aria-hidden />
            Zimbabwe marketplace
          </p>
          <h1 className="mt-3 max-w-xl text-4xl font-black leading-[1.03] tracking-tight sm:text-6xl">
            Buy and sell locally.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-zinc-300">
            Find used and new items, contact the seller directly, and agree on payment and collection.
          </p>
          <form action="/browse" method="get" className="mt-6 flex max-w-xl gap-2 rounded-lg border border-white/15 bg-white/5 p-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-orange-300" aria-hidden />
              <Label htmlFor="home-q" className="sr-only">Search listings</Label>
              <Input id="home-q" name="q" type="search" data-testid="home-search" placeholder="Search laptops, phones, consoles…" autoComplete="off" className="h-11 border-white/15 bg-[#202427] pl-9 text-white placeholder:text-zinc-400 focus-visible:ring-orange-300" />
            </div>
            <Button type="submit" size="lg" className="min-h-11 bg-orange-400 text-[#17191b] hover:bg-orange-300">Search</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild className="bg-orange-400 text-[#17191b] hover:bg-orange-300">
              <Link href="/browse">Browse listings</Link>
            </Button>
            <Button asChild variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white">
              <Link href="/sell">Sell an item</Link>
            </Button>
          </div>
        </div>
        <div className="hidden space-y-4 border-l border-white/15 pl-6 text-sm text-zinc-300 lg:block">
          <p className="flex items-start gap-3"><MessageCircle className="mt-0.5 size-5 shrink-0 text-orange-300" aria-hidden /><span>Call or WhatsApp the seller to check availability.</span></p>
          <p className="flex items-start gap-3"><Wallet className="mt-0.5 size-5 shrink-0 text-orange-300" aria-hidden /><span>Pay the seller by cash or a mobile wallet you both agree on.</span></p>
        </div>
      </div>
    </section>
  );
}
