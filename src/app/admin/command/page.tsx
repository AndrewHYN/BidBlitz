import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight, BadgeCheck, Banknote, ClipboardList, Flag, Gavel,
  Headset, Megaphone, PauseCircle, Scale, ShieldCheck, Users, Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { queueLabel, queueState } from "@/lib/operations/queue-health";

export const metadata: Metadata = {
  title: "Operations HQ",
  description: "Staff-only BidBlitz operations, finance and safety queues.",
  robots: { index: false, follow: false },
};

export default async function OperationsHQPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/command");

  const keys = [
    "admin.access", "admin.manage_team", "payments.view",
    "payouts.view", "disputes.view", "settings.manage_marketplace", "marketing.view",
  ] as const;
  const grants = await Promise.all(keys.map((key) =>
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: key })
  ));
  const permissions = new Map(keys.map((key, i) => [key, !grants[i].error && grants[i].data === true]));
  if (!permissions.get("admin.access")) redirect("/");

  const canFinance = Boolean(permissions.get("payments.view") || permissions.get("payouts.view"));
  const canDisputes = Boolean(permissions.get("disputes.view"));
  const canManagePromotions = Boolean(permissions.get("settings.manage_marketplace"));
  const canMarketing = canManagePromotions || Boolean(permissions.get("marketing.view"));
  const canTeam = Boolean(permissions.get("admin.manage_team"));

  // Security-definer count projection enforces live per-department grants;
  // raw RLS queries gave false "0" for non-owner staff. Failed reads are
  // unavailable, NEVER a successful empty queue.
  const [countResult, paymentSettings] = await Promise.all([
    supabase.rpc("admin_operations_queue_counts"),
    canFinance
      ? supabase.from("payment_settings").select("payments_enabled").maybeSingle()
      : Promise.resolve(null),
  ]);
  const rawCounts = !countResult.error && countResult.data && typeof countResult.data === "object"
    ? countResult.data as Record<string, unknown> : null;
  function queueCount(key: string): number | null {
    const raw = rawCounts?.[key];
    return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }

  const lanes = [
    { title: "Listing reviews", description: "Approve safe, complete listings before they go live.", count: queueCount("reviews"), href: "/admin#admin-reviews", icon: ClipboardList, category: "Operations" },
    { title: "Cancellation requests", description: "Check bids and policy before cancelling auctions.", count: queueCount("cancellations"), href: "/admin#admin-cancellations", icon: Gavel, category: "Operations" },
    { title: "Paused auctions", description: "Investigate or resume auctions held for safety.", count: queueCount("paused"), href: "/admin#admin-paused", icon: PauseCircle, category: "Trust & safety" },
    { title: "Open reports", description: "Review user and listing reports with an audit trail.", count: queueCount("reports"), href: "/admin#admin-reports", icon: Flag, category: "Trust & safety" },
    ...(canDisputes
      ? [{ title: "Unresolved disputes", description: "Keep payouts frozen while cases are under review.", count: queueCount("disputes"), href: "/admin/disputes", icon: Scale, category: "Disputes" }]
      : []),
    ...(canFinance
      ? [{ title: "Pending seller payouts", description: "Reconcile provider settlement before payout actions.", count: queueCount("payouts"), href: "/admin/finance/payouts", icon: Banknote, category: "Finance" }]
      : []),
    ...(canManagePromotions
      ? [{ title: "Promotion requests", description: "Review paid placements and quoted prices.", count: queueCount("promotions"), href: "/admin#admin-promotions", icon: Megaphone, category: "Marketing" }]
      : []),
  ];

  const displayed = lanes.filter((lane) => lane.count !== null);
  const requiringAttention = displayed.filter((lane) => lane.count !== 0);
  const unavailable = lanes.filter((lane) => lane.count === null);
  const paymentValue = paymentSettings && !paymentSettings.error
    ? paymentSettings.data?.payments_enabled
    : null;

  return (
    <div className="page-container space-y-8 py-8 sm:py-12" data-testid="admin-command-page">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-400/20 bg-[#151719] px-6 py-8 text-white shadow-2xl shadow-black/10 sm:px-9 sm:py-11">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20"
          style={{ backgroundImage: "linear-gradient(90deg,transparent 95%,#c47836 95%),linear-gradient(transparent 95%,#c47836 95%)", backgroundSize: "48px 48px" }} />
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-300">
              <Zap className="size-4" aria-hidden /> BidBlitz / Internal systems
            </div>
            <h1 className="mt-4 text-4xl font-black tracking-[-0.055em] sm:text-6xl">Operations HQ<span className="text-orange-400">.</span></h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-300 sm:text-base">
              One view of the work that protects the marketplace. Live queues, permission-scoped departments and deliberate financial controls.
            </p>
          </div>
          <div className="flex max-w-xs flex-col gap-1 rounded-xl border border-white/15 bg-white/5 p-4 text-xs">
            <span className="font-bold uppercase tracking-[0.15em] text-zinc-400">Payment switch</span>
            <span data-testid="hq-payment-status" className={paymentValue === true ? "text-lg font-bold text-emerald-300" : "text-lg font-bold text-amber-300"}>
              {!canFinance ? "Finance access required" : paymentValue === true ? "Enabled" : paymentValue === false ? "Paused" : "Not verified"}
            </span>
            <span className="leading-5 text-zinc-400">Provider balances and seller liabilities must be reconciled separately.</span>
          </div>
        </div>
      </header>

      <AdminNav active="command" showTeam={canTeam} showMarketing={canMarketing}
        disputeCount={canDisputes ? queueCount("disputes") ?? 0 : 0} />

      <section aria-label="Workload overview" className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Active queues</p>
          <p className="mt-3 text-4xl font-black tracking-tight" data-numeric>{requiringAttention.length}</p>
          <p className="mt-2 text-xs text-muted-foreground">Queues containing work, not total cases</p>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Confirmed clear</p>
          <p className="mt-3 text-4xl font-black tracking-tight" data-numeric>{displayed.length - requiringAttention.length}</p>
          <p className="mt-2 text-xs text-muted-foreground">Successfully queried with zero open items</p>
        </div>
        <div className={unavailable.length > 0 ? "rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5" : "rounded-2xl border bg-card p-5 shadow-sm"}>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Unavailable queues</p>
          <p className="mt-3 text-4xl font-black tracking-tight" data-numeric>{unavailable.length}</p>
          <p className="mt-2 text-xs text-muted-foreground">Never assumed empty when a read fails</p>
        </div>
      </section>

      <section aria-labelledby="work-queues-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-primary">01 / Act</p>
            <h2 id="work-queues-heading" className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Work queues</h2>
          </div>
          <span className="text-xs text-muted-foreground">Reads reflect your assigned permissions</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lanes.map((lane) => {
            const status = queueState(lane.count);
            const Icon = lane.icon;
            return (
              <Link key={lane.title} href={lane.href}
                className="group relative flex min-h-56 flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                data-testid="hq-work-queue">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className={status === "unavailable" ? "rounded-md bg-amber-500/10 px-2 py-1 text-xs font-bold text-amber-700 dark:text-amber-300"
                    : status === "clear" ? "rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300"
                    : "rounded-md bg-orange-500/10 px-2 py-1 text-xs font-bold text-orange-700 dark:text-orange-300"}>
                    {status === "clear" ? "Clear" : status === "unavailable" ? "Read unavailable" : "Needs review"}
                  </span>
                </div>
                <p className="mt-4 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">{lane.category}</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-extrabold tracking-tight">{lane.title}</h3>
                  <strong className="text-3xl tabular-nums tracking-tight" aria-label={queueLabel(lane.count)}>{queueLabel(lane.count)}</strong>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{lane.description}</p>
                <span className="mt-auto flex items-center gap-1 pt-4 text-xs font-bold text-primary">
                  Open workspace <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="departments-heading" className="space-y-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-primary">02 / Organize</p>
          <h2 id="departments-heading" className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Departments</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Department icon={ShieldCheck} title="Trust & safety" detail="Protect listings, review flagged activity, and document staff decisions."
            href="/admin#admin-reports" cta="Moderation desk" />
          {canDisputes && <Department icon={Scale} title="Dispute resolution" detail="Evidence-first case handling and payout holds."
            href="/admin/disputes" cta="Case queue" />}
          {canFinance && <Department icon={Banknote} title="Finance & settlement" detail="Separate recorded fees, provider funds, seller liabilities and paid transfers."
            href="/admin/finance" cta="Finance desk" />}
          <Department icon={Megaphone} title="Marketing & growth" detail="Prepare honest share campaigns; authorized staff review paid placements."
            href="/admin/marketing" cta="Growth studio" />
          {canTeam && <Department icon={Users} title="People & access" detail="Assign staff roles, suspend access and inspect the authorization audit."
            href="/admin/team" cta="Team roster" />}
          <Department icon={Headset} title="Seller & customer operations" detail="Help buyers and sellers complete safe, accurate auctions."
            href="/admin#admin-reviews" cta="Listing desk" />
        </div>
      </section>

      <footer className="flex flex-wrap items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-5 text-sm leading-6">
        <BadgeCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p><strong>Operations rule:</strong> dashboard counts are not proof of provider settlement.
          Do not release seller proceeds without the payout eligibility checks and verified provider acknowledgement.</p>
      </footer>
    </div>
  );
}

function Department({ icon: Icon, title, detail, href, cta }: {
  icon: typeof ShieldCheck;
  title: string;
  detail: string;
  href: string;
  cta: string;
}) {
  return (
    <Link href={href} className="group flex items-start gap-4 rounded-2xl border bg-card p-5 shadow-sm transition hover:border-primary/35 hover:shadow-md">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="font-extrabold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary">
          {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
