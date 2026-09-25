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
      className="flex flex-wrap gap-2"
    >
      {categories.map((category) => {
        const Icon = categoryIcon(category.slug);
        return (
          <Link
            key={category.slug}
            href={`/browse?category=${encodeURIComponent(category.slug)}`}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {category.name}
          </Link>
        );
      })}
    </nav>
  );
}
