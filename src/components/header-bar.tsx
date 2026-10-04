"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMounted } from "@/hooks/use-mounted";
import {
  Bell,
  Gavel,
  Menu,
  Moon,
  Plus,
  Search,
  ShieldAlert,
  Sun,
  User as UserIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandMark } from "@/components/brand-mark";
import { UserAvatar } from "@/components/profile/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/server/actions/auth";
import { createClient } from "@/lib/supabase/client";
import { shouldRefreshHeaderOnAuthEvent } from "@/lib/auth-events";
import { cn } from "@/lib/utils";

export type HeaderUser = {
  id: string;
  displayName: string;
  username: string | null;
  /** Storage KEY of the avatar in the `avatars` bucket - never a URL. */
  avatarPath: string | null;
  email: string | null;
  /**
   * Whether the account menu and drawer show the Admin entry. Presentation
   * only: every admin route and action re-checks server-side. This flag will
   * be backed by the `admin.access` permission once the RBAC migration lands
   * (docs/ADMIN_RBAC.md); until then it mirrors profiles.is_admin, which is
   * the current source of truth.
   */
  isAdmin: boolean;
};

const NAV = [
  { label: "Browse", href: "/browse" },
  { label: "Help", href: "/help" },
] as const;

/** Desktop shows the two anchors; the full set lives in the mobile drawer. */
const DESKTOP_AUTH_NAV = [
  { label: "Dashboard", href: "/dashboard", exact: true },
  { label: "Watchlist", href: "/dashboard/watchlist", exact: true },
] as const;

const AUTH_NAV = [
  { label: "Dashboard", href: "/dashboard", exact: true },
  { label: "Watchlist", href: "/dashboard/watchlist", exact: true },
  { label: "Bidding", href: "/dashboard/buying", exact: true },
  { label: "Selling", href: "/dashboard/selling", exact: true },
] as const;

/**
 * Active state: sections match their subtree (/help covers /help/fees), the
 * dashboard tabs are exact so only the tab you are on lights up.
 */
function isActive(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
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
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  // Escape closes the drawer; a history navigation (back/forward) closes it
  // too, so it can never hang open over a page it does not belong to. Both
  // are listener callbacks — the sanctioned place for state updates.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPopState() {
      setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onPopState);
    };
  }, [open]);

  // The `user` prop above is a server snapshot: after OAuth completes IN THE
  // BROWSER, the session exists but this render still shows "Sign in / Join"
  // until something re-reads the server. So this one subscription watches
  // Supabase auth events and asks Next to re-render the server tree — which
  // re-runs SiteHeader with live cookies — exactly when the snapshot is
  // known-stale, and never otherwise.
  //
  // One subscription, created once: the effect depends only on the stable
  // router, and `router.refresh()` re-renders without remounting, so the
  // effect never re-runs itself into a loop. Cleanup unsubscribes, so
  // StrictMode remounts and unmounts cannot leak or double-handle. No
  // tokens enter React state — the decision reads the event only.
  useEffect(() => {
    // What the server believed at mount. The effect runs once (stable
    // `router` dep below), so this closure value stays the mount snapshot
    // for the subscription's whole life; `known` tracks it forward as events
    // are acted on, so a duplicate delivery of the same event cannot queue a
    // second refresh for the same header.
    let known = user !== null;
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (shouldRefreshHeaderOnAuthEvent(event, session !== null, known)) {
        known = session !== null;
        router.refresh();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  // Mount-only by design (see above): `user` must NOT retrigger, or every
  // prop change would resubscribe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    router.push(q ? `/browse?q=${encodeURIComponent(q)}` : "/browse");
    setOpen(false);
  }

  const links = user ? [...NAV, ...AUTH_NAV] : NAV;
  const desktopLinks = user ? [...NAV, ...DESKTOP_AUTH_NAV] : NAV;
  // Admin discoverability: the entry appears if and only if the server says
  // the session is an admin. Visibility is not authorization - /admin and
  // every admin action re-check server-side - but an operator should not have
  // to guess the URL.
  const adminLink = user?.isAdmin
    ? [{ label: "Admin", href: "/admin", exact: true } as const]
    : [];
  /** Any in-header navigation also closes the drawer. */
  const closeMenu = () => setOpen(false);

  const drawerContent = (
    <div className="page-container space-y-3 py-4">
      <form
        onSubmit={submitSearch}
        /* GET, stated rather than defaulted: this is a navigation form and the
           query string is the correct result. Carries no secrets. */
        method="get"
        className="md:hidden"
      >
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
        {[...links, ...adminLink].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={() => setOpen(false)}
            aria-current={isActive(pathname, l.href, "exact" in l && l.exact) ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              isActive(pathname, l.href, "exact" in l && l.exact) &&
                "bg-accent text-accent-foreground"
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
  );

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
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>

        <Link
          href="/"
          onClick={closeMenu}
          aria-label="BidBlitz"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
        >
          <BrandMark size={32} priority />
          <span aria-hidden className="hidden sm:inline">BidBlitz</span>
        </Link>

        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 lg:flex">
          {desktopLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l.href, "exact" in l && l.exact) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                isActive(pathname, l.href, "exact" in l && l.exact) &&
                  "bg-accent text-accent-foreground"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <form
          onSubmit={submitSearch}
          method="get"
          className="ml-auto hidden min-w-0 flex-1 max-w-md md:flex"
        >
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
                <Link href="/notifications" onClick={closeMenu}>
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
                <Link href="/sell" onClick={closeMenu}>
                  <Plus className="size-4" /> Sell
                </Link>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                    <UserAvatar
                      avatarPath={user.avatarPath}
                      name={user.displayName}
                      // `size-7` is 28px; the default stock size (32px) is
                      // asked for, which over-delivers slightly rather than
                      // upscaling a 28px image across 32px.
                      pixelSize={32}
                      className="size-7"
                    />
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
                    <Link
                      href={user.username ? `/profile/${user.username}` : "/settings"}
                      onClick={closeMenu}
                    >
                      <UserIcon className="size-4" /> Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/transactions" onClick={closeMenu}>
                      <Gavel className="size-4" /> Transactions
                    </Link>
                  </DropdownMenuItem>
                  {user.isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin" onClick={closeMenu} data-testid="admin-menu-link">
                        <ShieldAlert className="size-4" /> Admin
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      closeMenu();
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
                <Link href="/login" onClick={closeMenu}>
                  Sign in
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup" onClick={closeMenu}>
                  Join
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* mobile drawer — transform/opacity only, standing down for reduced motion */}
      {open &&
        (reduceMotion ? (
          <div id="mobile-menu" className="border-t lg:hidden">
            {drawerContent}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            <motion.div
              id="mobile-menu"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden border-t lg:hidden"
            >
              {drawerContent}
            </motion.div>
          </AnimatePresence>
        ))}
    </header>
  );
}
