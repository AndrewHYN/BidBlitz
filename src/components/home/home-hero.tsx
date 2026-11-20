import Link from "next/link";
import { LayoutGrid, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function HomeHero({ locationPicker }: { locationPicker: React.ReactNode }) {
  return (
    <section data-testid="home-hero" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Marketplace<span className="sr-only"> in Zimbabwe</span></h1>
        {locationPicker}
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <form action="/browse" method="get" role="search" aria-label="Search the marketplace" className="relative">
          <label htmlFor="home-q" className="sr-only">Search listings</label>
          <Input id="home-q" name="q" type="search" data-testid="home-search" placeholder="Search listings" autoComplete="off" className="h-12 pr-14" />
          <button type="submit" aria-label="Search" title="Search" className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <Search className="size-5" aria-hidden />
          </button>
        </form>
        <div className="grid grid-cols-2 gap-2.5">
          <Button asChild variant="outline" className="home-action home-action-browse">
            <Link href="/browse"><LayoutGrid aria-hidden /> Browse listings</Link>
          </Button>
          <Button asChild variant="outline" className="home-action home-action-sell">
            <Link href="/sell"><Plus aria-hidden /> Sell an item</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
