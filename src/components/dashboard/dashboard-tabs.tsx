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
  { href: "/dashboard/selling", label: "My listings" },
  { href: "/dashboard/watchlist", label: "Saved items" },
] as const;

export function DashboardTabs() {
  const pathname = usePathname();
  if (pathname === "/dashboard/watchlist") return null;

  return (
    <nav
      data-testid="dashboard-tabs"
      aria-label="Dashboard sections"
      className="flex flex-wrap gap-1 rounded-xl border bg-muted/60 p-1.5 shadow-sm"
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
              "min-h-9 shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors",
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
