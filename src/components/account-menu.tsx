"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell, BellRing, Bookmark, ChevronDown, ChevronRight, CircleHelp, Gavel, History, LogOut, Mail, Package, ShieldAlert, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/profile/user-avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/server/actions/auth";
import { setMarketplaceEmailAlertsAction } from "@/server/actions/preferences";
import { cn } from "@/lib/utils";
import type { HeaderUser } from "@/components/header-bar";

const row = "min-h-11 cursor-pointer gap-3 rounded-xl px-3 py-2 text-sm font-medium focus:bg-accent";
const icon = "size-5 shrink-0 text-muted-foreground";
const section = "px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground";
type BrowserPermission = NotificationPermission | "unsupported";
function currentPermission(): BrowserPermission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

export function AccountMenu({ user }: { user: HeaderUser }) {
  const router = useRouter();
  const [email, setEmail] = useState(user.marketplaceEmailAlerts === true);
  const [permission, setPermission] = useState<BrowserPermission>("unsupported");
  const [pending, startTransition] = useTransition();

  function toggleEmail(next: boolean) {
    startTransition(async () => {
      try {
        const result = await setMarketplaceEmailAlertsAction(next);
        if (!result.ok) { toast.error(result.message); return; }
        setEmail(next);
        toast.success(next ? "Marketplace email alerts enabled" : "Marketplace email alerts disabled");
        router.refresh();
      } catch { toast.error("Could not save email preferences. Try again."); }
    });
  }

  async function enableBrowserAlerts() {
    const status = currentPermission();
    if (status === "unsupported") {
      toast.info("Browser alerts are unavailable on this device. In-app notifications still work.");
      return;
    }
    if (status === "denied") {
      toast.info("Allow notifications for BidBlitz in your browser site settings, then reopen this menu.");
      return;
    }
    if (status === "granted") {
      toast.info("Browser message alerts are already enabled while BidBlitz is open.");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") toast.success("Message alerts enabled while BidBlitz is open.");
      else if (result === "denied") toast.info("Notifications are blocked. Change your browser site permissions to enable them.");
      else toast.info("Permission was not granted. You can try again.");
    } catch { toast.error("This browser could not enable alerts. In-app notifications still work."); }
  }

  return (
    <DropdownMenu onOpenChange={(open) => {
      if (open) {
        setPermission(currentPermission());
        if (!pending) setEmail(user.marketplaceEmailAlerts === true);
      }
    }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 rounded-xl px-2 data-[state=open]:bg-accent" aria-label="Account menu">
          <UserAvatar avatarPath={user.avatarPath} name={user.displayName} pixelSize={32} className="size-7" />
          <span className="hidden max-w-28 truncate text-sm md:inline">{user.displayName}</span>
          <ChevronDown aria-hidden className="hidden size-3.5 text-muted-foreground md:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={12} collisionPadding={12}
        className="z-[60] w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-popover p-2 shadow-2xl ring-0">
        <DropdownMenuLabel className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-accent/40 p-3">
          <UserAvatar avatarPath={user.avatarPath} name={user.displayName} pixelSize={40} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-foreground">{user.displayName}</span>
            {user.email && <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuLabel className={section}>Your account</DropdownMenuLabel>
        <DropdownMenuItem asChild className={row}><Link href="/settings"><UserRound className={icon} /> <span className="flex-1">Profile &amp; account settings</span><ChevronRight className="size-4 text-muted-foreground" /></Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={row}><Link href="/dashboard/selling"><Package className={icon} />My listings</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={row}><Link href="/dashboard/watchlist"><Bookmark className={icon} />Saved items</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={section}>Notifications</DropdownMenuLabel>
        <DropdownMenuItem asChild className={row}><Link href="/notifications"><Bell className={icon} /><span className="flex-1">In-app notifications</span><ChevronRight className="size-4 text-muted-foreground" /></Link></DropdownMenuItem>
        <DropdownMenuItem className={row} onSelect={(event) => { event.preventDefault(); void enableBrowserAlerts(); }}>
          <BellRing className={icon} />
          <span className="min-w-0 flex-1"><span className="block">{permission === "granted" ? "Browser message alerts" : "Enable message alerts"}</span><span className="block text-xs font-normal text-muted-foreground">While BidBlitz is open</span></span>
          <span className={cn("rounded-md px-1.5 py-1 text-[10px] font-semibold", permission === "granted" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>{permission === "granted" ? "On" : permission === "denied" ? "Blocked" : permission === "unsupported" ? "Unavailable" : "Off"}</span>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={email} disabled={pending} onCheckedChange={toggleEmail}
          onSelect={(event) => event.preventDefault()}
          className={cn(row, "pr-3 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden")}>
          <Mail className={icon} />
          <span className="min-w-0 flex-1"><span className="block">Marketplace email alerts</span><span className="block text-xs font-normal text-muted-foreground">{pending ? "Saving…" : "New marketplace messages"}</span></span>
          <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", email ? "bg-blue-600" : "bg-muted-foreground/40")}><span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform", email && "translate-x-4")} /></span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className={section}>More</DropdownMenuLabel>
        <DropdownMenuItem asChild className={row}><Link href="/help"><CircleHelp className={icon} />Help and safety</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={row}><Link href="/dashboard/account"><History className={icon} />Previous sales account</Link></DropdownMenuItem>
        <DropdownMenuItem asChild className={row}><Link href="/dashboard/transactions"><Gavel className={icon} />Transactions</Link></DropdownMenuItem>
        {user.isAdmin && <DropdownMenuItem asChild className={row}><Link href="/admin" data-testid="admin-menu-link"><ShieldAlert className={icon} />Admin</Link></DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={row} variant="destructive" onSelect={(event) => { event.preventDefault(); void signOutAction(); }}>
          <LogOut className="size-5" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
