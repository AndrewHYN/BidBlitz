"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, HelpCircle, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  categoryMatches, groupedCategories, suggestedCategorySlugs,
  type CategoryOption,
} from "@/lib/category-taxonomy";

type ListingKind = "SALE" | "AUCTION" | "SERVICE";

/**
 * The mobile trigger makes searching obvious before opening the dialog.
 * An "Other" fallback is always one tap away, even for a search with no hits.
 * The selected ID remains the authoritative category sent to the server.
 */
export function CategoryPicker({
  categories, value, onChange, titleHint = "", kind, invalid = false,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (value: string) => void;
  titleHint?: string;
  kind: ListingKind;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sections = useMemo(() => groupedCategories(categories, kind), [categories, kind]);
  const available = sections.flatMap((section) => section.categories);
  const selected = available.find((category) => String(category.id) === value);
  const otherSlug = kind === "SERVICE" ? "other-services" : "other-items";
  const other = available.find((category) => category.slug === otherSlug);
  const isOtherSelected = selected?.slug === otherSlug;

  // A short product title can surface a one-tap recommendation before
  // the seller needs to open or scroll through a category list.
  const suggested = suggestedCategorySlugs(titleHint, kind)
    .map((slug) => available.find((category) => category.slug === slug))
    .filter((category): category is CategoryOption => Boolean(category));
  const filtered = sections.map((section) => ({
    ...section,
    categories: section.categories.filter((category) => categoryMatches(category, search)),
  })).filter((section) => section.categories.length > 0);

  function choose(id: number) {
    onChange(String(id));
    setOpen(false);
    setSearch("");
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setSearch("");
  }

  return (
    <div className="space-y-2">
      <button
        id="sell-category"
        type="button"
        data-testid="sell-category"
        aria-label={selected ? "Category: " + selected.name + ". Tap to search or change category" : "Search or choose a category"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => onOpenChange(true)}
        className="group flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-input bg-background px-4 text-left shadow-sm transition-[border-color,box-shadow] hover:border-primary/70 hover:shadow-md focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Search className="size-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className={selected ? "block truncate text-sm font-semibold text-foreground" : "block truncate text-sm font-medium text-foreground"}>
              {selected ? selected.name : "Search or choose a category"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {selected ? "Tap to change category" : "Type gaming PC, phone, livestock, or more"}
            </span>
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground" aria-hidden />
      </button>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {!selected && suggested.length > 0 ? (
          <button type="button" onClick={() => choose(suggested[0].id)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/5 px-3 text-xs font-semibold text-foreground hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring">
            Suggested: {suggested[0].name}
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {isOtherSelected ? "Describe your item clearly in the title." : "Search by product name, or browse groups."}
          </span>
        )}
        {other && !isOtherSelected && (
          <button type="button" data-testid="category-other-shortcut" onClick={() => choose(other.id)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold text-primary underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <HelpCircle className="size-4" aria-hidden />
            Not listed? Choose {other.name}
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-1.25rem)] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[min(80dvh,44rem)]">
          <DialogHeader className="gap-1 px-5 pb-3 pt-5">
            <DialogTitle className="text-lg font-bold tracking-tight">Find your category</DialogTitle>
            <DialogDescription>
              Start typing instead of scrolling. Search by item name, like gaming PC, laptop or rabbits.
            </DialogDescription>
          </DialogHeader>

          <div className="border-b px-4 pb-4 sm:px-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" aria-hidden />
              <Input
                autoFocus
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search categories..."
                aria-label="Search categories"
                data-testid="category-search"
                className="h-12 rounded-xl border-primary/30 pl-10 pr-3 text-base shadow-sm focus-visible:border-primary"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
            {!search.trim() && suggested.length > 0 && (
              <section aria-label="Suggested categories" className="mb-3">
                <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested for this listing</p>
                {suggested.map((category) => (
                  <button key={category.id} type="button" onClick={() => choose(category.id)}
                    className="mb-1 flex min-h-12 w-full items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-3 text-left text-sm font-semibold text-foreground hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring">
                    {category.name}
                    <ArrowRight className="size-4 text-primary" aria-hidden />
                  </button>
                ))}
              </section>
            )}

            {filtered.length ? filtered.map((section) => (
              <section key={section.label} aria-label={section.label} className="mb-3 last:mb-0">
                <p className="sticky top-0 z-10 bg-popover px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.categories.map((category) => (
                    <button key={category.id} type="button" onClick={() => choose(category.id)}
                      aria-pressed={selected?.id === category.id}
                      className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary/10 aria-pressed:text-foreground">
                      <span>{category.name}</span>
                      {selected?.id === category.id && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  ))}
                </div>
              </section>
            )) : (
              <div role="status" className="rounded-xl border border-dashed p-4 text-sm">
                <p className="font-semibold">No matching category for “{search.trim()}”</p>
                <p className="mt-1 text-muted-foreground">You can still post your listing. Use the Other category and describe it in the title.</p>
                {other && (
                  <button type="button" onClick={() => choose(other.id)}
                    className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring">
                    Choose {other.name} <ArrowRight className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            )}
          </div>

          {other && filtered.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t bg-popover px-5 py-3">
              <span className="text-xs text-muted-foreground">Can’t find a match?</span>
              <button type="button" onClick={() => choose(other.id)}
                data-testid="category-other-dialog"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground shadow-xs hover:border-primary/60 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                Use {other.name}
                <ArrowRight className="size-3.5" aria-hidden />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
