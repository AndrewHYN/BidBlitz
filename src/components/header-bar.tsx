"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "motion/react";
import { useMounted } from "@/hooks/use-mounted";
import {
  Bell,
  Gavel,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
  User as UserIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/server/actions/auth";
import { cn } from "@/lib/utils";

export type HeaderUser = {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  email: string | null;
};

const NAV = [
  { label: "Browse", href: "/browse" },
  { label: "How it works", href: "/help" },
] as const;

const AUTH_NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Watchlist", href: "/dashboard/watchlist" },
  { label: "Bidding", href: "/dashboard/buying" },
  { label: "Selling", href: "/dashboard/selling" },
] as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}

export function HeaderBar({
  user,
  unreadCount,
}: {
  user: HeaderUser | null;
  unreadCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/browse?q=${encodeURIComponent(q)}` : "/browse");
    setOpen(false);
  }

  const links = user ? [...NAV, ...AUTH_NAV] : NAV;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
      <div className="page-container flex h-16 items-center gap-3">
        {/* mobile menu trigger */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>

        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Gavel className="size-4" />
          </span>
          <span className="hidden sm:inline">BidBlitz</span>
        </Link>

        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 lg:flex">
          {NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                pathname.startsWith(l.href) && "bg-accent text-accent-foreground"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <form onSubmit={submitSearch} className="ml-auto hidden min-w-0 flex-1 max-w-md md:flex">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search auctions…"
              aria-label="Search auctions"
              className="pl-9"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <ThemeToggle />

          {user ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                asChild
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
                className="relative"
              >
                <Link href="/notifications">
                  <Bell className="size-4" />
                  {unreadCount > 0 && (
                    <span
                      data-testid="unread-badge"
                      className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white"
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Link>
              </Button>

              <Button asChild size="sm" className="hidden gap-1.5 sm:inline-flex">
                <Link href="/sell">
                  <Plus className="size-4" /> Sell
                </Link>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                    <Avatar className="size-7">
                      {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
                      <AvatarFallback>{initials(user.displayName)}</AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-28 truncate text-sm md:inline">
                      {user.displayName}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">
                    <span className="block truncate">{user.displayName}</span>
                    {user.email && (
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {user.email}
                      </span>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href={user.username ? `/profile/${user.username}` : "/settings"}>
                      <UserIcon className="size-4" /> Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/transactions">
                      <Gavel className="size-4" /> Transactions
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      void signOutAction();
                    }}
                  >
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Join</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* mobile drawer */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t lg:hidden"
          >
            <div className="page-container space-y-3 py-4">
              <form onSubmit={submitSearch} className="md:hidden">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder="Search auctions…"
                    aria-label="Search auctions"
                    className="pl-9"
                  />
                </div>
              </form>

              <nav aria-label="Mobile" className="grid gap-1">
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      pathname.startsWith(l.href) && "bg-accent text-accent-foreground"
                    )}
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>

              {user && (
                <Button asChild size="sm" className="w-full">
                  <Link href="/sell" onClick={() => setOpen(false)}>
                    <Plus className="size-4" /> List an item
                  </Link>
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
