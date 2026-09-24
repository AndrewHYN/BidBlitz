"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONDITIONS, conditionLabels, SORTS } from "@/lib/validation";

/**
 * Filter bar for /browse. Every change builds a fresh, shareable URL and
 * `router.replace`s it (never `push`, so filtering doesn't bury the back
 * button). Changing a filter always drops `page` — page 1 is the only honest
 * landing after the result set changes.
 *
 * State is seeded from server props; the page re-keys this component whenever
 * the validated URL state changes (own navigation, browser back/forward, a
 * link from elsewhere), so the controls can never drift from the URL without
 * a synchronising effect.
 */

export type BrowseFilterValues = {
  q: string;
  /** category slug, "" = all */
  category: string;
  /** condition value, "" = all */
  condition: string;
  min: string;
  max: string;
  sort: string;
};

export type CategoryOption = {
  slug: string;
  name: string;
  emoji: string | null;
};

/** Radix Select items cannot hold an empty-string value; "all" is our sentinel. */
const ALL = "all";

export function buildBrowseUrl(values: BrowseFilterValues): string {
  const params = new URLSearchParams();
  const q = values.q.trim();
  if (q) params.set("q", q);
  if (values.category) params.set("category", values.category);
  if (values.condition) params.set("condition", values.condition);
  const min = values.min.trim();
  if (min) params.set("min", min);
  const max = values.max.trim();
  if (max) params.set("max", max);
  params.set("sort", values.sort || "ending-soon");
  // No `page` here: any filter change resets to page 1 by construction.
  return `/browse?${params.toString()}`;
}

export function BrowseFilters({
  initial,
  categories,
}: {
  initial: BrowseFilterValues;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);

  function apply(next: BrowseFilterValues) {
    setValues(next);
    router.replace(buildBrowseUrl(next));
  }

  function patch(part: Partial<BrowseFilterValues>) {
    apply({ ...values, ...part });
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({ ...values, q: values.q });
  }

  return (
    <section
      data-testid="browse-filters"
      aria-label="Filter auctions"
      className="space-y-4 rounded-xl border bg-card p-4"
    >
      <form onSubmit={submitSearch} className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="browse-q">Search</Label>
            <Input
              id="browse-q"
              type="search"
              data-testid="browse-search"
              value={values.q}
              onChange={(event) => setValues((v) => ({ ...v, q: event.target.value }))}
              placeholder="Search by keyword…"
              autoComplete="off"
            />
          </div>
          <Button type="submit" variant="secondary" className="h-8">
            <Search aria-hidden />
            Search
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="browse-category">Category</Label>
            <Select
              value={values.category || ALL}
              onValueChange={(value) =>
                patch({ category: value === ALL ? "" : value })
              }
            >
              <SelectTrigger
                id="browse-category"
                type="button"
                data-testid="browse-category"
                className="h-8 w-full"
              >
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.slug} value={category.slug}>
                    {category.emoji ? `${category.emoji} ` : ""}
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="browse-condition">Condition</Label>
            <Select
              value={values.condition || ALL}
              onValueChange={(value) =>
                patch({ condition: value === ALL ? "" : value })
              }
            >
              <SelectTrigger
                id="browse-condition"
                type="button"
                data-testid="browse-condition"
                className="h-8 w-full"
              >
                <SelectValue placeholder="Any condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any condition</SelectItem>
                {CONDITIONS.map((condition) => (
                  <SelectItem key={condition} value={condition}>
                    {conditionLabels[condition]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="browse-sort">Sort by</Label>
            <Select value={values.sort} onValueChange={(value) => patch({ sort: value })}>
              <SelectTrigger
                id="browse-sort"
                type="button"
                data-testid="browse-sort"
                className="h-8 w-full"
              >
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="browse-min">Min price</Label>
            <Input
              id="browse-min"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={values.min}
              onChange={(event) => patch({ min: event.target.value })}
              placeholder="0"
              aria-describedby="browse-price-hint"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="browse-max">Max price</Label>
            <Input
              id="browse-max"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={values.max}
              onChange={(event) => patch({ max: event.target.value })}
              placeholder="Any"
              aria-describedby="browse-price-hint"
            />
          </div>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p id="browse-price-hint" className="text-xs text-muted-foreground">
          Prices are whole minor units (cents) — 1000 means $10.00.
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href="/browse" aria-label="Clear all filters">
            <X aria-hidden />
            Clear filters
          </Link>
        </Button>
      </div>
    </section>
  );
}
