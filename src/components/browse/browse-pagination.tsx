import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Prev / Next over the current filter set. Every link re-applies the raw query
 * string the page received (minus `page`), so paging never silently drops a
 * filter — and page 1 is written as the bare `/browse` shape.
 */
function pageHref(params: Record<string, string>, page: number): string {
  const search = new URLSearchParams(params);
  if (page > 1) search.set("page", String(page));
  else search.delete("page");
  const qs = search.toString();
  return qs ? `/browse?${qs}` : "/browse";
}

export function BrowsePagination({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Raw, validated query params to preserve across pages (without `page`). */
  params: Record<string, string>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      data-testid="browse-pagination"
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground">
        Page <span data-numeric>{page}</span> of{" "}
        <span data-numeric>{totalPages}</span>
      </p>

      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(params, page - 1)} rel="prev">
              <ChevronLeft aria-hidden />
              Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled aria-disabled="true">
            <ChevronLeft aria-hidden />
            Previous
          </Button>
        )}

        {hasNext ? (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(params, page + 1)} rel="next">
              Next
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled aria-disabled="true">
            Next
            <ChevronRight aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}
