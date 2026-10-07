import Link from "next/link";
import { BookOpen, Gauge, Megaphone, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin#admin-promotions-heading", label: "Promotions", icon: Megaphone },
  { href: "/admin/guide", label: "Guide", icon: BookOpen },
  { href: "/admin/team", label: "Team", icon: Users },
] as const;

export function AdminNav({ active = "overview", showTeam = false }: { active?: "overview" | "guide"; showTeam?: boolean }) {
  return (
    <nav aria-label="Admin sections" className="flex gap-2 overflow-x-auto rounded-xl border bg-muted/40 p-1.5 shadow-sm">
      {ITEMS.filter((item) => showTeam || item.href !== "/admin/team").map(({ href, label, icon: Icon }) => {
        const selected = (active === "guide" && href === "/admin/guide") || (active === "overview" && href === "/admin");
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
          </Link>
        );
      })}
    </nav>
  );
}
