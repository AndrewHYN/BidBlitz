import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Gavel, ShieldCheck, Sparkles, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { InvitationControls } from "@/components/referrals/invitation-controls";

export const metadata: Metadata = {
  title: "Invite a friend",
  description: "Invite genuine buyers and sellers to BidBlitz, Zimbabwe's auction marketplace.",
  robots: { index: false, follow: false },
};

export default async function ReferralsPage({ searchParams }: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const inviteCode = typeof params.code === "string" && /^BB[A-F0-9]{10}$/i.test(params.code)
    ? params.code.toUpperCase() : null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const loginPath = inviteCode
    ? `/login?next=${encodeURIComponent("/referrals?code=" + inviteCode)}`
    : "/login?next=/referrals";

  const [codeResult, summaryResult] = user
    ? await Promise.all([
      supabase.rpc("my_referral_code"),
      supabase.rpc("my_referral_summary"),
    ])
    : [null, null];
  const yourCode = !codeResult?.error && typeof codeResult?.data?.code === "string"
    ? codeResult.data.code as string : null;
  const count = summaryResult && !summaryResult.error && Number.isSafeInteger(summaryResult.data?.signups)
    ? summaryResult.data.signups as number : null;
  const redeemed = !summaryResult?.error && summaryResult?.data?.hasRedeemed === true;

  return (
    <main className="page-container space-y-8 py-8 sm:py-14" data-testid="referral-program">
      <section className="relative overflow-hidden rounded-[1.75rem] border border-orange-400/20 bg-[#131619] px-6 py-9 text-white shadow-[0_30px_90px_-45px_rgba(0,0,0,.75)] sm:px-11 sm:py-12">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-80 rotate-12 rounded-[3rem] border-[35px] border-orange-400/10" />
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[.2em] text-orange-300">
          <Sparkles className="size-4" aria-hidden /> The BidBlitz community
        </p>
        <h1 className="relative mt-4 max-w-2xl text-4xl font-black tracking-[-.055em] sm:text-6xl">
          Bring the crowd<span className="text-orange-400">.</span>
        </h1>
        <p className="relative mt-5 max-w-2xl text-sm leading-7 text-zinc-300 sm:text-base">
          Share a real invitation to BidBlitz. Every invited account is recorded only when that person chooses
          to accept your code. No staged bids, inflated numbers, or automatic cash rewards.
        </p>
        <div className="relative mt-6 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-lg border border-white/20 bg-white/5 px-3 py-2">One invite per newcomer</span>
          <span className="rounded-lg border border-white/20 bg-white/5 px-3 py-2">No hidden charges</span>
          <span className="rounded-lg border border-white/20 bg-white/5 px-3 py-2">Community first</span>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(17rem,.6fr)]">
        <div className="space-y-5">
          {!user ? (
            <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
              <h2 className="text-xl font-black">Sign in to join the community</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Your invite link will remain attached to this page after signing in.
                A new verified account can redeem it before its first completed purchase.
              </p>
              <Button asChild><Link href={loginPath}>Sign in to continue <ArrowRight className="ml-2 size-4" aria-hidden /></Link></Button>
            </div>
          ) : (
            <>
              {codeResult?.error && <p role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
                Your invitation code could not be created. Confirm your email address and account eligibility, or retry later.
              </p>}
              {summaryResult?.error && <p role="alert" className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
                Referral totals could not be verified. No sign-ups are being assumed.
              </p>}
              <InvitationControls code={yourCode} inviteCode={inviteCode} alreadyRedeemed={redeemed} />
              {count !== null && (
                <div className="rounded-2xl border bg-card p-5 shadow-sm">
                  <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
                    <Users className="size-4 text-primary" aria-hidden /> Accepted invitations
                  </p>
                  <p className="mt-3 text-4xl font-black tabular-nums">{count}</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Genuine, voluntarily accepted account invitations only. Not purchases or earned commission.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <aside className="space-y-4">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <ShieldCheck className="size-6 text-primary" aria-hidden />
            <h2 className="mt-3 font-extrabold">What your code does</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Helps BidBlitz understand which community members introduced genuine new accounts.
              Your friends still decide whether to join, bid or sell.
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <BadgeCheck className="size-6 text-primary" aria-hidden />
            <h2 className="mt-3 font-extrabold">No artificial incentives</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              There are no cash rewards, referral bonuses or fee discounts yet.
              Future incentives require published rules and fraud protections.
            </p>
          </div>
          <Link href="/browse" className="group flex items-center justify-between gap-3 rounded-2xl border bg-primary/5 p-5 font-bold transition hover:border-primary/40">
            <span className="flex items-center gap-2"><Gavel className="size-5 text-primary" aria-hidden /> Explore real auctions</span>
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </Link>
        </aside>
      </div>
    </main>
  );
}
