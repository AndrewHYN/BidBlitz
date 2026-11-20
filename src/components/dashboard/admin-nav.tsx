import Link from "next/link";
import { Activity, Banknote, BookOpen, Gauge, Megaphone, Scale, Users, Headset, ClipboardCheck } from "lucide-react";
import { callerId, effectivePermissions } from "@/server/permissions";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", label: "Overview", icon: Gauge, key: "overview" },
  { href: "/admin/command", label: "Queues", icon: Activity, key: "command" },
  { href: "/admin/listings", label: "Listings", icon: ClipboardCheck, key: "listings" },
  { href: "/admin/disputes", label: "Disputes", icon: Scale, key: "disputes" },
  { href: "/admin/finance", label: "Finance", icon: Banknote, key: "finance" },
  { href: "/admin/marketing", label: "Marketing", icon: Megaphone, key: "marketing" },
  { href: "/admin/support", label: "Support", icon: Headset, key: "support" },
  { href: "/admin/guide", label: "Guide", icon: BookOpen, key: "guide" },
  { href: "/admin/team", label: "Team", icon: Users, key: "team" },
] as const;

export async function AdminNav({
  active = "overview",
  showTeam = false,
  showMarketing = false,
  showSupport = false,
  showListings = false,
  disputeCount = 0,
}: {
  active?: "listings" | "command" | "overview" | "disputes" | "finance" | "marketing" | "support" | "guide" | "team";
  showTeam?: boolean;
  showMarketing?: boolean;
  showSupport?: boolean;
  showListings?: boolean;
  disputeCount?: number;
}) {
  const userId = await callerId();
  const permissions = new Set(userId ? await effectivePermissions(userId) : []);
  const can = (permission: string) => permissions.has("*") || permissions.has(permission);
  const visible = {
    team: showTeam || can("admin.manage_team"),
    marketing: showMarketing || can("marketing.view") || can("settings.manage_marketplace"),
    support: showSupport || can("support.manage"),
    listings: showListings || can("listings.review"),
    disputes: can("disputes.view"),
    finance: can("payments.view") || can("payouts.view"),
    overview: true,
    command: true,
    guide: true,
  };

  return (
    <nav
      aria-label="Admin sections"
      className="grid grid-cols-2 gap-1 rounded-xl border bg-card p-1.5 min-[380px]:grid-cols-3 sm:grid-cols-5 lg:flex lg:flex-wrap"
    >
      {ITEMS.filter(({ key }) => key === active || visible[key]).map(
        ({ href, label, icon: Icon, key }) => {
          const selected = active === key;
          return (
            <Link
              key={href}
              href={href}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition lg:px-3",
                "hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary",
                selected && "bg-primary/10 font-semibold text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
              {key === "disputes" && disputeCount > 0 && (
                <span
                  data-numeric
                  className="grid min-w-5 place-items-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground"
                >
                  {disputeCount > 99 ? "99+" : disputeCount}
                </span>
              )}
            </Link>
          );
        }
      )}
    </nav>
  );
}
