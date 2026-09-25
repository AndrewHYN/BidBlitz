import Link from "next/link";
import { Gavel, Mail, Phone } from "lucide-react";

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
                className="transition-colors hover:text-foreground"
              >
                0789335669
              </a>
            </p>
            <p className="flex items-center gap-2 text-muted-foreground">
              <Mail className="size-4 shrink-0" aria-hidden />
              <a
                href="mailto:hyndrrx0@gmail.com"
                className="transition-colors hover:text-foreground"
              >
                hyndrrx0@gmail.com
              </a>
            </p>
          </div>
        </div>

        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title} className="space-y-3">
            <h3 className="text-sm font-medium">{col.title}</h3>
            <ul className="space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
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
            No payment provider is connected yet — no money changes hands
            through BidBlitz.
          </p>
        </div>
      </div>
    </footer>
  );
}
