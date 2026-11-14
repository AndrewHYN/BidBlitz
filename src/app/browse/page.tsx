import Link from "next/link";
import type { Metadata } from "next";
import { SearchX, TriangleAlert } from "lucide-react";

import { browseListings, getCategories } from "@/server/queries";
import { browseParamsSchema } from "@/lib/validation";
import { AuctionGrid } from "@/components/auction/auction-card";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";
import {
  BrowseFilters,
  type BrowseFilterValues,
} from "@/components/browse/browse-filters";
import { BrowsePagination } from "@/components/browse/browse-pagination";

export const metadata: Metadata = {
  title: "Browse listings",
  description:
    "Find items for sale across Zimbabwe and contact sellers directly.",
  alternates: { canonical: "/browse" },
};

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Next hands repeated keys as arrays; the first value is the one we show. */
function flatten(raw: RawSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
  }
  return out;
}

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 10_000);
}

/**
 * Validate the URL through the shared schema. A bad key (wrong enum, `min=abc`,
 * an over-cap amount) is dropped and the rest re-parsed — one broken parameter
 * must never take the whole page down, and whatever survives is both what the
 * query runs with and what the filter controls show.
 */
function parseFilters(flat: Record<string, string>): {
  values: BrowseFilterValues;
} {
  let parsed = browseParamsSchema.safeParse(flat);
  if (!parsed.success) {
    const cleaned = { ...flat };
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") delete cleaned[key];
    }
    parsed = browseParamsSchema.safeParse(cleaned);
  }
  const filters = parsed.success ? parsed.data : browseParamsSchema.parse({});

  return {
    values: {
      q: filters.q ?? "",
      category: filters.category ?? "",
      condition: filters.condition ?? "",
      min: filters.min === undefined ? "" : String(filters.min),
      max: filters.max === undefined ? "" : String(filters.max),
      sort: filters.sort === "ending-soon" || filters.sort === "most-bids" ? "newest" : filters.sort,
      location: filters.location ?? "",
    },
  };
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const flat = flatten(await searchParams);
  const { values } = parseFilters(flat);
  const page = parsePage(flat.page);

  /**
   * "Nothing matches" and "there is nothing here" are different situations
   * and must not say the same thing. With no filters applied, an empty result
   * means the marketplace has no listings at all — which is a fact about the
   * business, not a dead end, and the copy below says so.
   */
  const hasFilters = Boolean(
    values.q ||
      values.category ||
      values.condition ||
      values.min ||
      values.max ||
      values.location
  );

  const [result, categories] = await Promise.all([
    browseListings({
      q: values.q || undefined,
      category: values.category || undefined,
      condition: values.condition || undefined,
      min: values.min === "" ? undefined : Number(values.min),
      max: values.max === "" ? undefined : Number(values.max),
      location: values.location || undefined,
      sort: values.sort,
      page,
    }),
    getCategories(),
  ]);

  // Preserves whatever the visitor actually had in the URL (including keys
  // the schema doesn't model) so paging never silently drops a parameter.
  const paginationParams: Record<string, string> = { ...flat };
  delete paginationParams.page;

  return (
    <div className="page-container py-10 sm:py-14">
      <PageHeader
        title="Browse listings"
        description="Find items by category, location, condition and asking price."
      />

      <div className="mt-6">
        <BrowseFilters
          key={JSON.stringify(values)}
          initial={values}
          categories={categories}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        {/* Pluralised properly. This read "1 auctions" until the owner's own
            first real listing made a result count of exactly 1 possible - the
            page had never been rendered with one result, so the string was
            never seen. The count is the user's first indication of whether their
            search worked, so it is worth being grammatically correct. */}
        <p data-testid="browse-result-count" className="text-sm text-muted-foreground">
          {result.total} {result.total === 1 ? "listing" : "listings"}
        </p>
      </div>

      {result.error ? (
        <div className="mt-6">
          <EmptyState
            icon={TriangleAlert}
            title="We couldn't load listings"
            description="Something went wrong fetching results. Give it another try in a moment."
            action={
              <Button asChild variant="outline">
                <Link href="/browse">Try again</Link>
              </Button>
            }
          />
        </div>
      ) : result.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={SearchX}
            title={hasFilters ? "No listings match those filters" : "No listings yet"}
            description={
              hasFilters
                ? "Try a wider price range or a different category, or clear everything and start over."
                : "Published items will appear here. You can list something to sell today."
            }
            action={
              hasFilters ? (
                <Button asChild>
                  <Link href="/browse">Clear filters</Link>
                </Button>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button asChild>
                    <Link href="/sell">List an item</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/">Back to home</Link>
                  </Button>
                </div>
              )
            }
          />
        </div>
      ) : (
        <>
          <div data-testid="browse-grid" className="mt-6">
            {/* The results sit directly under the page h1, with no section heading in
          between, so each card title is an h2. Under a profile's "Listings"
          heading the same grid keeps h3, which is why this is stated rather than
          hardcoded in the grid. */}
      <AuctionGrid items={result.items} headingLevel="h2" />
          </div>

          {result.total > result.pageSize && (
            <div className="mt-8">
              <BrowsePagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                params={paginationParams}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
