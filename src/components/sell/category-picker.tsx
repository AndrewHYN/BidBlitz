"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, LayoutGrid, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  categoryMatches, groupedCategories, suggestedCategorySlugs,
  type CategoryOption,
} from "@/lib/category-taxonomy";

export function CategoryPicker({
  categories, value, onChange, titleHint = "", kind, invalid = false,
}: {
  categories: CategoryOption[];
  value: string;
  onChange: (value: string) => void;
  titleHint?: string;
  kind: "SALE" | "AUCTION" | "SERVICE";
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = categories.find((category) => String(category.id) === value);
  const sections = useMemo(() => groupedCategories(categories, kind), [categories, kind]);
  const visible = sections.map((section) => ({
    ...section,
    categories: section.categories.filter((category) => categoryMatches(category, search)),
  })).filter((section) => section.categories.length > 0);
  const suggestions = !search.trim()
    ? suggestedCategorySlugs(titleHint, kind)
        .map((slug) => categories.find((category) => category.slug === slug))
        .filter((category): category is CategoryOption => Boolean(category))
    : [];

  function choose(id: number) {
    onChange(String(id));
    setSearch("");
    setOpen(false);
  }

  return (
    <>
      <button
        id="sell-category"
        type="button"
        data-testid="sell-category"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 text-left text-sm shadow-xs transition-colors hover:border-foreground/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive"
      >
        <span className="flex min-w-0 items-center gap-2">
          <LayoutGrid className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className={selected ? "truncate font-medium" : "truncate text-muted-foreground"}>
            {selected ? selected.name : "Find your category"}
          </span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}>
        <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1rem)] max-w-lg flex-col gap-3 overflow-hidden p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle>Choose a category</DialogTitle>
            <DialogDescription>
              Search for what you sell, for example gaming PC, rabbit, phone, or cleaning.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search categories"
              aria-label="Search categories"
              data-testid="category-search"
              className="h-11 pl-9"
            />
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
            {suggestions.length > 0 && (
              <section aria-label="Suggested categories">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Suggested for your listing
                </p>
                {suggestions.map((category) => (
                  <button key={category.id} type="button" onClick={() => choose(category.id)}
                    className="mb-1 flex min-h-11 w-full items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-primary/10">
                    {category.name}
                    {selected?.id === category.id && <Check className="size-4" aria-hidden />}
                  </button>
                ))}
              </section>
            )}
            {visible.map((section) => (
              <section key={section.label} aria-label={section.label}>
                <p className="sticky top-0 z-10 bg-popover py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.categories.map((category) => (
                    <button key={category.id} type="button" onClick={() => choose(category.id)}
                      aria-pressed={selected?.id === category.id}
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/10 aria-pressed:font-semibold">
                      <span>{category.name}</span>
                      {selected?.id === category.id && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {visible.length === 0 && (
              <p role="status" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No matching category. Try a simpler word, or choose Other items.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
