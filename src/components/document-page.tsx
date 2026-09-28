import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The treatment for every long-form page: the terms, the privacy policy and the
 * three help pages.
 *
 * They were previously a stack of identical cards — twelve of them on the Terms
 * page, four on Help — which is the "unrelated paragraph, own box" failure the
 * design direction warns about. It also read badly: this text is read, not
 * skimmed, and a border around every three-paragraph block breaks the
 * paragraph rhythm that reading depends on while adding a dozen competing
 * frames.
 *
 * The decision is that these are **documents**, and that one decision should
 * serve all five pages rather than each page inventing its own spacing. So:
 *
 *  - one continuous measure (68ch, close to the readable line for body text at
 *    this size) instead of a narrow centred column inside a card;
 *  - sections separated by space and a heading with real presence, not borders;
 *  - a sticky table of contents at `lg`, because twelve sections with anchor
 *    targets and no visible index is a navigation problem the page was already
 *    half-solving with `scroll-mt-24`;
 *  - and below `lg` the contents collapse to a plain list, never a hidden
 *    control. Nothing here is interactive-only.
 *
 * The card is kept for exactly one thing on these pages: the contact block,
 * which is a real object — a way to reach a person — and earns a box.
 */
export function DocumentPage({
  children,
  toc,
  className,
}: {
  children: React.ReactNode;
  /** Section titles, in order, for the table of contents. */
  toc?: readonly { id: string; title: string }[];
  className?: string;
}) {
  return (
    <div className={cn("page-container py-10 sm:py-14", className)}>
      {toc && toc.length > 2 ? (
        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12 xl:gap-16">
          <nav
            aria-label="On this page"
            className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
          >
            <p className="mb-3 text-xs font-medium tracking-wide text-foreground">
              On this page
            </p>
            <ol className="space-y-1.5 border-l border-border/70 pl-4">
              {toc.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-4 block border-l border-transparent pl-4 text-sm leading-snug text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:border-primary focus-visible:text-foreground focus-visible:outline-none"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="min-w-0 space-y-10 sm:space-y-12">
            {toc.length > 0 && (
              <details className="group lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm font-medium marker:content-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  On this page
                  <span
                    aria-hidden
                    className="text-muted-foreground transition-transform group-open:rotate-180"
                  >
                    ▾
                  </span>
                </summary>
                <ol className="mt-3 space-y-1.5 border-l border-border/70 pl-4">
                  {toc.map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="text-sm text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                      >
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {children}
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-[68ch] space-y-10 sm:space-y-12">{children}</div>
      )}
    </div>
  );
}

/**
 * One numbered section of a document.
 *
 * No box. The heading carries a hairline above it so the eye can find its
 * place in a long page, and that rule does the work a card border used to do
 * without interrupting the text.
 */
export function DocumentSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      <h2 className="mb-4 border-t border-border/70 pt-8 text-lg font-semibold tracking-tight sm:text-xl">
        {title}
      </h2>
      <div className="space-y-4 text-[0.9375rem] leading-[1.75] text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:list-disc">
        {children}
      </div>
    </section>
  );
}

/**
 * The one box a document page is allowed.
 *
 * Contact details are an object a user acts on, so a frame is honest here —
 * and it gives the page a single, deliberate edge rather than a dozen.
 */
export function DocumentContactCard({
  title = "Contact",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section id="contact" className="scroll-mt-24">
      <h2 className="mb-4 border-t border-border/70 pt-8 text-lg font-semibold tracking-tight sm:text-xl">
        {title}
      </h2>
      <div className="rounded-xl border bg-card/60 p-5 sm:p-6">{children}</div>
    </section>
  );
}

/**
 * A framed block inside a document — for content that genuinely is an object.
 *
 * A worked fee example is a receipt: you read it line by line and compare the
 * numbers, which is exactly what a frame is for. Prose is not, and gets no
 * frame. Keeping both in one document is what stops the page from drifting
 * back to "every block is a card".
 */
export function DocumentFigure({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y rounded-xl border bg-card/60 px-5 py-1 sm:px-6">{children}</div>
  );
}

/** The small "also see" links that close a policy page. */
export function DocumentCrossLinks() {
  return (
    <p className="text-sm text-muted-foreground">
      See also:{" "}
      <Link
        href="/privacy"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Privacy policy
      </Link>
      ,{" "}
      <Link
        href="/help/rules"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        bidding rules
      </Link>{" "}
      and{" "}
      <Link
        href="/help/fees"
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        fees
      </Link>
      .
    </p>
  );
}
