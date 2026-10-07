import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Banknote,
  BookOpen,
  CheckCircle2,
  Flag,
  Gavel,
  Megaphone,
  Scale,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/permissions";
import { PageHeader } from "@/components/auction/page-header";
import { AdminNav } from "@/components/dashboard/admin-nav";

export const metadata = {
  title: "Admin guide",
  description: "A simple BidBlitz operations guide for staff.",
  robots: { index: false, follow: false },
};

const GUIDES = [
  {
    icon: CheckCircle2,
    title: "Listing reviews",
    accent: "Review before buyers see it",
    steps: [
      "Open the held listing and compare the title, description, photos, condition and handover details.",
      "Approve only when the listing is clear enough for a bidder to understand what they are committing to.",
      "Request changes when the item can be fixed without moderation action. Reject when it should not go public.",
    ],
  },
  {
    icon: Flag,
    title: "Reports",
    accent: "Investigate, then record the outcome",
    steps: [
      "Read the report and inspect the target before changing any status.",
      "Pause a live auction when bidders need protection while you investigate.",
      "Use takedown only for a real rules breach. The reason becomes part of the moderation record.",
    ],
  },
  {
    icon: Megaphone,
    title: "Promotions",
    accent: "Placement only, never auction advantage",
    steps: [
      "Check that the auction is live or scheduled and looks suitable for extra visibility.",
      "Approve the requested 3-day or 7-day period only after your promotion arrangement is settled.",
      "Promotion changes discovery placement. It never changes bid order, timing, rules, winner selection or settlement.",
    ],
  },
  {
    icon: Scale,
    title: "Disputes",
    accent: "Freeze facts, not stories",
    steps: [
      "Read the transaction conversation, case timeline, evidence and payout state before deciding anything.",
      "Use Waiting for buyer / seller when you need a response, and Under review when staff are actively assessing the case.",
      "Resolve with a factual outcome plus Release, Hold or No payout change. This workflow never issues a refund.",
    ],
  },
  {
    icon: TriangleAlert,
    title: "Cancellations",
    accent: "Protect bidders when bids already exist",
    steps: [
      "A no-bid seller cancellation can happen normally. A live auction with bids needs staff review.",
      "Read the seller reason and inspect the bid state before approving.",
      "If declined, explain why clearly. The auction continues unchanged.",
    ],
  },
  {
    icon: Banknote,
    title: "Payouts",
    accent: "Payment and seller payout are separate",
    steps: [
      "PAID means the buyer payment was confirmed. It does not mean the seller was paid.",
      "Do not move payout state unless the required fulfilment and payout conditions are actually satisfied.",
      "Keep provider references and internal notes factual. Never infer delivery from a payout.",
    ],
  },
  {
    icon: ShieldAlert,
    title: "Safety",
    accent: "Never invent trust signals",
    steps: [
      "Do not claim BidBlitz verified an identity, item or handover unless the platform actually did.",
      "Encourage public-place collection in daylight where practical and keep arrangements inside the transaction thread.",
      "Never ask users for passwords, PINs or one-time codes.",
    ],
  },
] as const;

export default async function AdminGuidePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/guide");

  const [canAdmin, canManageTeam, canViewDisputes] = await Promise.all([
    hasPermission(user.id, "admin.access"),
    hasPermission(user.id, "admin.manage_team"),
    hasPermission(user.id, "disputes.view"),
  ]);
  if (!canAdmin) redirect("/");

  const { count: openDisputeCount } = canViewDisputes
    ? await supabase
        .from("transaction_disputes")
        .select("id", { count: "exact", head: true })
        .neq("status", "RESOLVED")
    : { count: 0 };

  return (
    <div className="page-container space-y-8 py-10 sm:py-14">
      <PageHeader
        title="Staff guide"
        description="The short version of how to operate BidBlitz safely when work lands in your queue."
        actions={
          <Link href="/admin" className="text-sm font-semibold text-primary hover:underline">
            Back to admin
          </Link>
        }
      />

      <AdminNav
        active="guide"
        showTeam={canManageTeam}
        disputeCount={openDisputeCount ?? 0}
      />

      <section className="relative overflow-hidden rounded-2xl border bg-foreground p-6 text-background shadow-xl shadow-black/5 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right,currentColor 1px,transparent 1px),linear-gradient(to bottom,currentColor 1px,transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-background/65">
            <BookOpen className="size-4" aria-hidden />
            Operator rule
          </div>
          <p className="mt-4 text-2xl font-bold tracking-[-0.025em] sm:text-3xl">
            Protect the marketplace first. Move fast only when the evidence is clear.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-background/65">
            BidBlitz records important staff decisions. If a decision affects a bidder, seller, payment or payout, use the real state in front of you rather than guessing.
          </p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {GUIDES.map(({ icon: Icon, title, accent, steps }) => (
          <section key={title} className="group rounded-2xl border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-lg font-bold tracking-tight">{title}</h2>
                <p className="text-sm font-medium text-primary">{accent}</p>
              </div>
            </div>
            <ol className="mt-5 space-y-3">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border bg-background text-[11px] font-bold text-foreground">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
        <div className="flex gap-3">
          <Gavel className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div>
            <h2 className="font-bold">One rule that never changes</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Staff tools do not replace the auction engine. Bid order, anti-sniping, closing, settlement and payment state remain server-controlled even when you are an administrator.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
