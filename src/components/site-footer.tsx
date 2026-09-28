import Link from "next/link";
import { Gavel, Mail, Phone } from "lucide-react";
import { isPaymentProviderConfigured } from "@/server/payments/config";

const COLUMNS = [
  {
    title: "Marketplace",
    links: [
      { label: "Browse auctions", href: "/browse" },
      { label: "Ending soon", href: "/browse?sort=ending-soon" },
      { label: "Newest", href: "/browse?sort=newest" },
      { label: "Sell an item", href: "/sell" },
    ],
  },
  {
    title: "Your account",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Watchlist", href: "/dashboard/watchlist" },
      { label: "Bidding", href: "/dashboard/buying" },
      { label: "Selling", href: "/dashboard/selling" },
    ],
  },
  {
    title: "Trust & safety",
    links: [
      { label: "Bidding rules", href: "/help/rules" },
      { label: "How fees work", href: "/help/fees" },
      { label: "Terms of use", href: "/terms" },
      { label: "Privacy policy", href: "/privacy" },
      { label: "Help & contact", href: "/help" },
    ],
  },
] as const;

export function SiteFooter() {
  // Read once, server-side: the footer must never claim a state the
  // deployment does not have. With Paynow configured the old "no provider"
  // sentence would be false, so both branches are kept honest.
  const paymentConfigured = isPaymentProviderConfigured();

  return (
    <footer className="mt-auto border-t bg-card/50">
      <div className="page-container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Gavel className="size-4" />
            </span>
            BidBlitz
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            Live auctions with real closing times. Sellers list items, buyers
            compete bid by bid, and the highest bidder when the clock runs out
            wins.
          </p>

          <div className="space-y-1.5 text-sm">
            <p className="font-medium">Contact</p>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Phone className="size-4 shrink-0" aria-hidden />
              <a
                href="tel:0789335669"
                // Same target-size fix as the nav columns: these measured 20px
                // tall on a 390px viewport. A tap target you have to hit twice is
                // a support call.
                className="-my-1 inline-block py-1 transition-colors hover:text-foreground"
              >
                0789335669
              </a>
            </p>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Mail className="size-4 shrink-0" aria-hidden />
              <a
                href="mailto:hyndrrx0@gmail.com"
                className="-my-1 inline-block py-1 transition-colors hover:text-foreground"
              >
                hyndrrx0@gmail.com
              </a>
            </p>
          </div>
        </div>

        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title} className="space-y-3">
            {/* An `h2`, not an `h3`. The footer columns are the last section of
                every page, and they were the only headings on the page, so every
                single page had a level skipped: `h1` in the content, then `h3`
                here, with no `h2` between. That was measured on all twelve
                public pages, not spotted in one. The visual size is unchanged —
                only the level is corrected, so a screen reader navigating by
                heading gets a proper outline of the page. */}
            <h2 className="text-sm font-medium">{col.title}</h2>
            <ul className="space-y-1">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    // `inline-block` plus vertical padding grows the hit area to
                    // ~30px tall for a 14px line. Measured on the live site at
                    // 390px: these rendered 18px tall, which fails WCAG 2.5.8
                    // Target Size (Minimum, AA: 24x24 CSS px) and is a genuine
                    // mis-tap risk in a phone browser. The negative margin
                    // absorbs the extra padding so the column keeps the same
                    // visual rhythm, and the hover background is dropped
                    // deliberately: it would paint a block behind text that
                    // must not look like a button.
                    className="-my-1 inline-block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t">
        <div className="page-container flex flex-col gap-2 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} BidBlitz. All prices are in US dollars.</p>
          <p>
            {paymentConfigured
              ? "Payments are processed by Paynow. A sale is marked paid only once Paynow confirms it."
              : "No payment provider is connected yet, so no money changes hands through BidBlitz."}
          </p>
        </div>
      </div>
    </footer>
  );
}
