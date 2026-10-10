import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardCheck, Megaphone, ShieldCheck, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { CampaignLinkBuilder } from "@/components/dashboard/campaign-link-builder";
import { countFromQuery, queueLabel } from "@/lib/operations/queue-health";

export const metadata: Metadata = {
  title: "Growth studio",
  description: "Staff-only BidBlitz campaigns and listing promotions.",
  robots: { index: false, follow: false },
};

export default async function MarketingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/marketing");

  const [access, marketing, team, marketingView] = await Promise.all([
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "admin.access" }),
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "settings.manage_marketplace" }),
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "admin.manage_team" }),
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "marketing.view" }),
  ]);
  const canReviewPromotions = !marketing.error && marketing.data === true;
  const canViewCampaigns = !marketingView.error && marketingView.data === true;
  if (access.error || access.data !== true || (!canViewCampaigns && !canReviewPromotions)) redirect("/");

  const promotionCount = canReviewPromotions
    ? countFromQuery(await supabase.from("promotion_requests")
        .select("id", { count: "exact", head: true }).eq("status", "PENDING"))
    : null;

  return (
    <div className="page-container space-y-8 py-8 sm:py-12" data-testid="admin-marketing-page">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-orange-400/20 bg-[#161719] p-7 text-white shadow-xl sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-72 rotate-12 rounded-[3rem] border-[32px] border-orange-400/10" />
        <div className="relative max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-orange-300">
            <Megaphone className="size-4" aria-hidden /> BidBlitz / Growth
          </p>
          <h1 className="mt-4 text-4xl font-black tracking-[-0.05em] sm:text-6xl">Growth studio<span className="text-orange-400">.</span></h1>
          <p className="mt-4 text-sm leading-7 text-zinc-300 sm:text-base">
            Make every campaign trackable, every seller promotion intentional,
            and every marketing claim something we can prove.
          </p>
        </div>
      </header>

      <AdminNav active="marketing" showMarketing showTeam={team.data === true && !team.error} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,1fr)]">
        <CampaignLinkBuilder />
        <div className="space-y-4">
          {canReviewPromotions && <Link href="/admin#admin-promotions" className="group block rounded-2xl border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <ClipboardCheck className="size-5" aria-hidden />
              </span>
              <strong className="text-3xl tabular-nums">{queueLabel(promotionCount)}</strong>
            </div>
            <h2 className="mt-4 font-extrabold">Seller promotions awaiting review</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review the real listing request, quoted amount and seller eligibility before approving a placement.
            </p>
            <span className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-primary">
              Open approval queue <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>}
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-extrabold"><ShieldCheck className="size-5 text-primary" aria-hidden /> Publishing standards</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              No fabricated bids, sellers, reviews, prices, revenue, or urgency.
              Use permission-based email lists and visible unsubscribe controls.
              Promotions must be identifiable as sponsored placement.
            </p>
          </section>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-extrabold"><TrendingUp className="size-5 text-primary" aria-hidden /> The first growth targets</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Recruit verified local sellers, publish useful auction walkthroughs,
              and measure first bids, completed transactions, repeat customers and disputes.
              These are targets, not current performance statistics.
            </p>
          </section>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        New to operations? <Link href="/admin/guide" className="font-semibold text-primary underline-offset-4 hover:underline">Read the staff guide</Link>.
      </p>
    </div>
  );
}
