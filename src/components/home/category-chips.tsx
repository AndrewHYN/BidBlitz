import Link from "next/link";
import { LayoutGrid } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HomeFilterPanel } from "@/components/home/home-filter-panel";
import { categoryIcon } from "@/lib/category-icons";

export type HomeCategory = {
  slug: string;
  name: string;
  emoji: string | null;
};

/** "Browse by category" chips — each one is a ready-made /browse link. */
export function CategoryChips({ categories }: { categories: HomeCategory[] }) {
  if (categories.length === 0) return null;

  return (
    <>
      <Button type="button" variant="ghost" popoverTarget="home-category-panel" aria-haspopup="dialog" className="gap-1.5 px-2 text-sm">
        <LayoutGrid aria-hidden /> Categories
      </Button>
      <HomeFilterPanel id="home-category-panel" title="Browse by category">
        <nav data-testid="home-category-chips" aria-label="Browse by category" className="grid gap-1 sm:grid-cols-2">
          {categories.map((category) => {
            const Icon = categoryIcon(category.slug);
            return (
              <Link
                key={category.slug}
                href={`/browse?category=${encodeURIComponent(category.slug)}`}
                className="group flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>{category.name}</span>
              </Link>
            );
          })}
        </nav>
      </HomeFilterPanel>
    </>
  );
}
