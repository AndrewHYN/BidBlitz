import Link from "next/link";
import { LayoutGrid } from "lucide-react";

import { EmptyState } from "@/components/auction/page-header";
import { categoryIcon } from "@/lib/category-icons";

export type HomeCategory = {
  slug: string;
  name: string;
  emoji: string | null;
};

/** "Browse by category" chips — each one is a ready-made /browse link. */
export function CategoryChips({ categories }: { categories: HomeCategory[] }) {
  if (categories.length === 0) {
    return (
      <nav data-testid="home-category-chips" aria-label="Browse by category">
        <EmptyState
          compact
          icon={LayoutGrid}
          title="No categories yet"
          description="Categories will appear here as the catalog fills up."
        />
      </nav>
    );
  }

  return (
    <nav
      data-testid="home-category-chips"
      aria-label="Browse by category"
      className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
    >
      {categories.map((category) => {
        const Icon = categoryIcon(category.slug);
        return (
          <Link
            key={category.slug}
            href={`/browse?category=${encodeURIComponent(category.slug)}`}
            className="group interactive-surface inline-flex min-h-11 items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 text-sm font-semibold shadow-sm hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-primary">
              <Icon className="size-4" aria-hidden />
            </span>
            <span>{category.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
