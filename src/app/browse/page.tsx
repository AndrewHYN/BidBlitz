import Link from "next/link";
import { SearchX, TriangleAlert } from "lucide-react";

import { browseAuctions, getCategories } from "@/server/queries";
import { browseParamsSchema } from "@/lib/validation";
import { AuctionGrid } from "@/components/auction/auction-card";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Button } from "@/components/ui/button";
import {
  BrowseFilters,
  type BrowseFilterValues,
} from "@/components/browse/browse-filters";
import { BrowsePagination } from "@/components/browse/browse-pagination";

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
  location: string | undefined;
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
      sort: filters.sort,
    },
    // No control in the bar yet, but a shared `?location=` URL must still filter.
    location: filters.location || undefined,
  };
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const flat = flatten(await searchParams);
  const { values, location } = parseFilters(flat);
  const page = parsePage(flat.page);

  const [result, categories] = await Promise.all([
    browseAuctions({
      q: values.q || undefined,
      category: values.category || undefined,
      condition: values.condition || undefined,
      min: values.min === "" ? undefined : Number(values.min),
      max: values.max === "" ? undefined : Number(values.max),
      location,
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
        title="Browse auctions"
        description="Filter live and upcoming listings — every change lands in the URL, so results are shareable."
      />

      <div className="mt-6">
        <BrowseFilters
          key={JSON.stringify(values)}
          initial={values}
          categories={categories}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p data-testid="browse-result-count" className="text-sm text-muted-foreground">
          {result.total} auctions
        </p>
      </div>

      {result.error ? (
        <div className="mt-6">
          <EmptyState
            icon={TriangleAlert}
            title="We couldn't load auctions"
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
            title="No auctions match those filters"
            description="Try a wider price range or a different category — or clear everything and start over."
            action={
              <Button asChild>
                <Link href="/browse">Clear filters</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div data-testid="browse-grid" className="mt-6">
            <AuctionGrid items={result.items} />
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
