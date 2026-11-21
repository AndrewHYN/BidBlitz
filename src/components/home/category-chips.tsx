"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HomeFilterPanel } from "@/components/home/home-filter-panel";
import { categoryIcon } from "@/lib/category-icons";
import { groupedCategories } from "@/lib/category-taxonomy";
import { Input } from "@/components/ui/input";

export type HomeCategory = {
  slug: string;
  name: string;
  emoji: string | null;
};

/** "Browse by category" chips — each one is a ready-made /browse link. */
export function CategoryChips({ categories }: { categories: HomeCategory[] }) {
  const [search, setSearch] = useState("");
  if (categories.length === 0) return null;
  const groups = [...groupedCategories(categories, "SALE"), ...groupedCategories(categories, "SERVICE")]
    .map((section) => ({ ...section, categories: section.categories.filter((category) =>
      (category.name + " " + category.slug + " " + section.label).toLowerCase().includes(search.trim().toLowerCase())
    ) })).filter((section) => section.categories.length > 0);

  return (
    <>
      <Button type="button" variant="ghost" popoverTarget="home-category-panel" aria-haspopup="dialog" className="gap-1.5 px-2 text-sm">
        <LayoutGrid aria-hidden /> Categories
      </Button>
      <HomeFilterPanel id="home-category-panel" title="Browse by category">
        <div className="mb-3">
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            aria-label="Find a category" placeholder="Find a category..." />
        </div>
        <nav data-testid="home-category-chips" aria-label="Browse by category" className="space-y-3">
          {groups.map((section) => (
            <section key={section.label}>
              <h3 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</h3>
              <div className="grid gap-1 sm:grid-cols-2">
                {section.categories.map((category) => {
                  const Icon = categoryIcon(category.slug);
                  return (
                    <Link key={category.slug} href={"/browse?category=" + encodeURIComponent(category.slug)}
                      className="group flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-primary">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span>{category.name}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className="py-5 text-center text-sm text-muted-foreground">No categories found.</p>}
        </nav>
      </HomeFilterPanel>
    </>
  );
}
