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
import { categoryIcon } from "@/lib/category-icons";
import { formatMoney, money, parseMoneyToMinor } from "@/lib/money";

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

/**
 * The URL keeps whole minor units (the server contract), but the controls
 * speak dollars — customers should never have to know what a minor unit is.
 * `minorToDollars("1250") -> "12.50"`, `parseMoneyToMinor("12.50") -> 1250n`.
 */
function minorToDollars(minor: string): string {
  if (!minor) return "";
  try {
    return formatMoney(money(minor)).replace(/[^0-9.]/g, "");
  } catch {
    return "";
  }
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
  // Price drafts live in dollars and only reach the URL when committed
  // (blur or submit), so typing never triggers a navigation per keystroke.
  const [minDraft, setMinDraft] = useState(() => minorToDollars(initial.min));
  const [maxDraft, setMaxDraft] = useState(() => minorToDollars(initial.max));
  const [priceError, setPriceError] = useState<string | null>(null);

  const PRICE_ERROR = "Enter a price in dollars, e.g. 25 or 12.50.";

  /** Fold whatever is typed into the price boxes into the next URL state. */
  function foldDrafts(next: BrowseFilterValues): {
    merged: BrowseFilterValues;
    invalid: boolean;
  } {
    const merged = { ...next };
    let invalid = false;
    const drafts = [
      ["min", minDraft] as const,
      ["max", maxDraft] as const,
    ];
    for (const [which, draft] of drafts) {
      const trimmed = draft.trim();
      if (trimmed === "") {
        // A cleared box means "no limit" — drop any committed value.
        if (merged[which] !== "") merged[which] = "";
        continue;
      }
      const minor = parseMoneyToMinor(trimmed);
      if (minor === null) {
        invalid = true;
        continue;
      }
      merged[which] = minor.toString();
    }
    return { merged, invalid };
  }

  function apply(next: BrowseFilterValues) {
    const { merged, invalid } = foldDrafts(next);
    setPriceError(invalid ? PRICE_ERROR : null);
    setValues(merged);
    router.replace(buildBrowseUrl(merged));
  }

  function patch(part: Partial<BrowseFilterValues>) {
    apply({ ...values, ...part });
  }

  function commitPrice(which: "min" | "max") {
    const draft = (which === "min" ? minDraft : maxDraft).trim();
    if (draft === "") {
      setPriceError(null);
      if (values[which] !== "") apply({ ...values, [which]: "" });
      return;
    }
    const minor = parseMoneyToMinor(draft);
    if (minor === null) {
      // Keep what was typed so it can be fixed — the message says how.
      setPriceError(PRICE_ERROR);
      return;
    }
    setPriceError(null);
    const asMinor = minor.toString();
    if (asMinor !== values[which]) apply({ ...values, [which]: asMinor });
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
                {categories.map((category) => {
                  const Icon = categoryIcon(category.slug);
                  return (
                    <SelectItem key={category.slug} value={category.slug}>
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {category.name}
                    </SelectItem>
                  );
                })}
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
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={minDraft}
              onChange={(event) => {
                setMinDraft(event.target.value);
                setPriceError(null);
              }}
              onBlur={() => commitPrice("min")}
              placeholder="From"
              aria-invalid={priceError ? true : undefined}
              aria-describedby={
                priceError ? "browse-price-hint browse-price-error" : "browse-price-hint"
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="browse-max">Max price</Label>
            <Input
              id="browse-max"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={maxDraft}
              onChange={(event) => {
                setMaxDraft(event.target.value);
                setPriceError(null);
              }}
              onBlur={() => commitPrice("max")}
              placeholder="To"
              aria-invalid={priceError ? true : undefined}
              aria-describedby={
                priceError ? "browse-price-hint browse-price-error" : "browse-price-hint"
              }
            />
          </div>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="space-y-1">
          <p id="browse-price-hint" className="text-xs text-muted-foreground">
            Prices in dollars — e.g. 25 or 12.50. Filters by each
            auction&apos;s current price.
          </p>
          {priceError && (
            <p
              id="browse-price-error"
              role="alert"
              className="text-xs font-medium text-destructive"
            >
              {priceError}
            </p>
          )}
        </div>
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
