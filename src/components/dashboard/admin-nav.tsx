import Link from "next/link";
import { Activity, Banknote, BookOpen, Gauge, Megaphone, Scale, Users, Headset } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin/command", label: "HQ", icon: Activity, key: "command" },
  { href: "/admin", label: "Overview", icon: Gauge, key: "overview" },
  { href: "/admin/disputes", label: "Disputes", icon: Scale, key: "disputes" },
  { href: "/admin/finance", label: "Finance", icon: Banknote, key: "finance" },
  { href: "/admin/marketing", label: "Marketing", icon: Megaphone, key: "marketing" },
  { href: "/admin/support", label: "Support", icon: Headset, key: "support" },
  { href: "/admin#admin-promotions-heading", label: "Promotions", icon: Megaphone, key: "promotions" },
  { href: "/admin/guide", label: "Guide", icon: BookOpen, key: "guide" },
  { href: "/admin/team", label: "Team", icon: Users, key: "team" },
] as const;

export function AdminNav({
  active = "overview",
  showTeam = false,
  showMarketing = false,
  showSupport = false,
  disputeCount = 0,
}: {
  active?: "command" | "overview" | "disputes" | "finance" | "marketing" | "support" | "promotions" | "guide" | "team";
  showTeam?: boolean;
  showMarketing?: boolean;
  showSupport?: boolean;
  disputeCount?: number;
}) {
  return (
    <nav
      aria-label="Admin sections"
      className="flex gap-2 overflow-x-auto rounded-xl border bg-muted/40 p-1.5 shadow-sm"
    >
      {ITEMS.filter((item) =>
        (showTeam || item.key !== "team") &&
        (showMarketing || item.key !== "marketing") &&
        (showSupport || item.key !== "support")
      ).map(
        ({ href, label, icon: Icon, key }) => {
          const selected = active === key;
          return (
            <Link
              key={href}
              href={href}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition",
                "hover:bg-background hover:text-foreground hover:shadow-sm",
                selected && "bg-background text-foreground shadow-sm"
              )}
            >
              <Icon className="size-4" aria-hidden />
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
