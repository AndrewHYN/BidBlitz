import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardCheck, Megaphone, ShieldCheck, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { CampaignLinkBuilder } from "@/components/dashboard/campaign-link-builder";
import { countFromQuery, queueLabel } from "@/lib/operations/queue-health";
import { CreateCampaignForm } from "@/components/dashboard/create-campaign-form";
import { CampaignLifecycle } from "@/components/dashboard/campaign-lifecycle";
import { CopyCampaignLink } from "@/components/dashboard/copy-campaign-link";
import { buildCampaignUrl } from "@/lib/marketing/campaign-links";
import { money, formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Growth studio",
  description: "Staff-only BidBlitz campaigns and listing promotions.",
  robots: { index: false, follow: false },
};

export default async function MarketingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/marketing");

  const [access, marketing, team, marketingView, marketingManage] = await Promise.all([
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "admin.access" }),
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "settings.manage_marketplace" }),
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "admin.manage_team" }),
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "marketing.view" }),
    supabase.rpc("has_permission", { p_user_id: user.id, p_permission: "marketing.manage" }),
  ]);
  const canReviewPromotions = !marketing.error && marketing.data === true;
  const canViewCampaigns = !marketingView.error && marketingView.data === true;
  if (access.error || access.data !== true || (!canViewCampaigns && !canReviewPromotions)) redirect("/");

  const promotionCount = canReviewPromotions
    ? countFromQuery(await supabase.from("promotion_requests")
        .select("id", { count: "exact", head: true }).eq("status", "PENDING"))
    : null;

  const canManageCampaigns = canReviewPromotions ||
    (!marketingManage.error && marketingManage.data === true);
  const campaignsRes = await supabase.from("marketing_campaigns")
    .select("id, title, objective, destination, source, medium, campaign_tag, content_tag, brief, planned_budget_minor, currency, planned_start, status, created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  type CampaignRow = {
    id: string; title: string; objective: string; destination: "home" | "auctions" | "sell";
    source: string; medium: string; campaign_tag: string; content_tag: string | null;
    brief: string; planned_budget_minor: number | string; currency: string;
    planned_start: string | null; status: string; created_at: string;
  };
  const campaigns = (campaignsRes.data ?? []) as CampaignRow[];
  const consentRes = await supabase.rpc("staff_marketing_opt_in_summary");
  const referralRes = await supabase.rpc("staff_referral_summary");
  const referralData = !referralRes.error && referralRes.data && typeof referralRes.data === "object"
    ? referralRes.data as Record<string, unknown> : null;
  const marketingOptIns = !consentRes.error && typeof consentRes.data?.optedIn === "number"
    ? consentRes.data.optedIn as number : null;
  const issuedCodes = typeof referralData?.issuedCodes === "number" ? referralData.issuedCodes : null;
  const redeemedInvitations = typeof referralData?.redeemedInvitations === "number"
    ? referralData.redeemedInvitations : null;

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
      <section aria-label="Marketing consent" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5">
        <div className="max-w-2xl">
          <h2 className="text-base font-extrabold">Consent-controlled marketing audience</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Only verified accounts that explicitly enabled optional marketplace emails and have an
            opt-in audit timestamp count. This is an audience estimate, not an email export.
          </p>
        </div>
        <div className="rounded-xl border bg-card px-5 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Confirmed opt-ins</p>
          <p className="mt-1 text-3xl font-black tabular-nums">{marketingOptIns === null ? "Unavailable" : marketingOptIns}</p>
        </div>
      </section>

      <section aria-label="Referral growth" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">Generated invite codes</p>
          <p className="mt-3 text-4xl font-black tabular-nums">{issuedCodes === null ? "Unavailable" : issuedCodes}</p>
          <p className="mt-2 text-xs text-muted-foreground">Real, verified accounts only</p>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">Accepted invitations</p>
          <p className="mt-3 text-4xl font-black tabular-nums">{redeemedInvitations === null ? "Unavailable" : redeemedInvitations}</p>
          <p className="mt-2 text-xs text-muted-foreground">Not sales, revenue, or paid conversions</p>
        </div>
        <Link href="/referrals" className="group flex flex-col justify-between rounded-2xl border border-orange-500/20 bg-[#17191a] p-5 text-white shadow-sm transition hover:shadow-lg">
          <div>
            <h2 className="text-lg font-black">BidBlitz invitations</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">A genuine community sharing channel, without automatic cash rewards or manipulated performance.</p>
          </div>
          <span className="mt-4 flex items-center gap-2 text-xs font-bold text-orange-300">See public referral experience <ArrowRight className="size-4 transition group-hover:translate-x-1" aria-hidden /></span>
        </Link>
      </section>

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

      <section aria-labelledby="campaign-pipeline-heading" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">03 / Campaign control</p>
            <h2 id="campaign-pipeline-heading" className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Your campaign pipeline</h2>
            <p className="mt-2 text-sm text-muted-foreground">Real saved plans with explicit staff approval and audit history.</p>
          </div>
          {!campaignsRes.error && (
            <div className="rounded-xl border bg-card px-4 py-3">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Visible plans</p>
              <p className="mt-1 text-3xl font-black tabular-nums">{campaigns.length}</p>
            </div>
          )}
        </div>
        {canManageCampaigns && <CreateCampaignForm />}
        {campaignsRes.error ? (
          <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive">
            Campaign records are unavailable. The app will not pretend there are no campaigns.
          </p>
        ) : campaigns.length === 0 ? (
          <p className="rounded-xl border bg-card p-6 text-sm leading-6 text-muted-foreground">
            No campaigns have been saved yet. Start with a verified-seller recruitment campaign, then create a shareable tracking link.
          </p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {campaigns.map((campaign) => {
              const campaignLink = buildCampaignUrl({
                origin: "https://bidblitz.co.zw",
                destination: campaign.destination,
                source: campaign.source,
                medium: campaign.medium,
                campaign: campaign.campaign_tag,
                content: campaign.content_tag ?? undefined,
              });
              return (
                <li key={campaign.id} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm" data-testid="marketing-campaign-row">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">
                        {campaign.objective.replaceAll("_", " ")}
                      </p>
                      <h3 className="mt-2 text-lg font-black tracking-tight">{campaign.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Saved {new Date(campaign.created_at).toLocaleDateString("en-US")}
                        {campaign.planned_start
                          ? ` · Planning: ${new Date(campaign.planned_start).toLocaleDateString("en-US")}`
                          : ""}
                      </p>
                    </div>
                    <span className={campaign.status === "RUNNING"
                      ? "rounded-md border border-orange-500/25 bg-orange-500/10 px-2.5 py-1 text-xs font-extrabold text-orange-700 dark:text-orange-300"
                      : campaign.status === "COMPLETED"
                        ? "rounded-md border bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground"
                        : "rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-bold text-primary"}>
                      {campaign.status}
                    </span>
                  </div>
                  <p className="text-xs leading-6 text-muted-foreground">{campaign.brief || "No creative brief recorded."}</p>
                  <div className="grid gap-3 rounded-xl bg-muted/30 p-4 text-xs sm:grid-cols-2">
                    <div><span className="text-muted-foreground">Planned budget</span>
                      <p className="mt-1 text-base font-black">{formatMoney(money(campaign.planned_budget_minor, campaign.currency))}</p></div>
                    <div><span className="text-muted-foreground">Channel</span>
                      <p className="mt-1 text-base font-bold">{campaign.source} / {campaign.medium}</p></div>
                  </div>
                  <CopyCampaignLink link={campaignLink} />
                  {canManageCampaigns ? <CampaignLifecycle campaignId={campaign.id} status={campaign.status} /> :
                    <p className="text-xs text-muted-foreground">Read-only. Ask a marketing manager to update this plan.</p>}
                  <p className="border-t pt-3 text-[11px] leading-5 text-muted-foreground">
                    RUNNING indicates a staff-managed campaign; it does not automatically buy ads, send messages, or verify conversions.
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        New to operations? <Link href="/admin/guide" className="font-semibold text-primary underline-offset-4 hover:underline">Read the staff guide</Link>.
      </p>
    </div>
  );
}
