"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Dashboard section switcher. It is a real `<nav>` of links rather than
 * Radix `Tabs`, because these are ROUTES — they must be crawlable, openable
 * in a new tab and correct without JavaScript.
 */

const TABS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/buying", label: "Buying" },
  { href: "/dashboard/selling", label: "Selling" },
  { href: "/dashboard/watchlist", label: "Watchlist" },
  { href: "/dashboard/transactions", label: "Transactions" },
] as const;

export function DashboardTabs() {
  const pathname = usePathname();

  return (
    <nav
      data-testid="dashboard-tabs"
      aria-label="Dashboard sections"
      className="flex flex-wrap gap-1 rounded-lg border bg-muted p-1"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
