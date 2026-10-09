import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1 sm:flex-1">
        <h1 className="break-words text-2xl font-bold tracking-[-0.02em] text-balance sm:text-3xl">{title}</h1>
        {description && (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground text-balance">{description}</p>
        )}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * An empty state is a real answer, not a placeholder.
 *
 * The previous version drew a `border-dashed` box with `py-16` and put the icon
 * in a filled circle. Dashed is the vocabulary of *incomplete* — "fill this in",
 * "coming soon" — and an empty marketplace is neither: it is a true fact about
 * the business, with a clear reason and a clear next step. On the homepage and
 * Browse that box measured ~320px tall and held ~60px of content, so the void
 * read as something broken rather than something intentional.
 *
 * What is left is only the information: a title that says what is true, one
 * tight sentence, and the actions. Structure comes from a hairline rule and
 * space, which is what the rest of the page uses, so the empty state belongs to
 * the same composition instead of floating inside a frame.
 *
 * The icon is a bare glyph in muted ink, not a coloured disc — repeated icon
 * circles are the fastest way to make an interface look generated, and there is
 * no second thing here that needs one.
 *
 * `compact` is for an empty state nested inside a panel (an empty rail, a
 * profile with no listings). `full` is a page-level state.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-t border-border/70",
        compact ? "py-8" : "py-12 sm:py-14",
        className
      )}
      data-testid="empty-state"
    >
      <div
        className={cn(
          "flex flex-col gap-3",
          // Page-level states read left-aligned at desktop, matching the
          // editorial home page. Nested ones stay compact and centred, because
          // they sit inside a narrow column and centring keeps them calm.
          compact ? "items-center text-center" : "sm:items-start sm:text-left"
        )}
      >
        <div className={cn("space-y-1.5", !compact && "max-w-xl")}>
          <h2
            className={cn(
              "font-semibold tracking-tight text-foreground",
              compact ? "text-sm" : "text-lg sm:text-xl"
            )}
          >
            {title}
          </h2>
          {description && (
            <p
              className={cn(
                "text-sm leading-relaxed text-muted-foreground text-pretty",
                compact ? "mx-auto max-w-xs" : "max-w-lg"
              )}
            >
              {description}
            </p>
          )}
        </div>

        {(Icon || action) && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-3",
              !compact && "pt-1",
              !compact && "sm:pt-2"
            )}
          >
            {Icon && <Icon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  action,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-end justify-between gap-4", className)}>
      <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}
