import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, CircleDollarSign, Handshake, MessageCircleOff, ShieldCheck, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getThread } from "@/server/queries";
import { PageHeader } from "@/components/auction/page-header";
import { TransactionBadge } from "@/components/auction/status-badge";
import { MessageThread } from "@/components/dashboard/message-thread";
import { ReportDialog } from "@/components/auction/report-dialog";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sale conversation",
  description: "Private messages between the buyer and seller of one sale.",
  robots: { index: false, follow: false },
};

/**
 * One sale's private thread. Only the buyer and the seller of this
 * transaction ever see it: every other case — forged id, signed-in
 * non-party, missing migration — renders the same "not available" state, so
 * the page never distinguishes "no such thread" from "not yours".
 */
export default async function TransactionThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/transactions/${id}`);

  const thread = await getThread(user.id, id);
  if (!thread) {
    return (
      <div className="page-container py-10 sm:py-14">
        <div className="mx-auto w-full max-w-lg space-y-5 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <MessageCircleOff className="size-5" aria-hidden />
          </span>
          <div className="space-y-2" data-testid="thread-unavailable">
            <h1 className="text-xl font-semibold tracking-tight">This conversation is not available</h1>
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              Conversations belong to the buyer and seller of one sale. If you
              followed a link here, ask for a fresh one from your transactions.
            </p>
          </div>
          <Button asChild className="w-full">
            <Link href="/dashboard/transactions">Back to transactions</Link>
          </Button>
        </div>
      </div>
    );
  }

  const role = thread.role === "moderator" ? "Moderator" : thread.seller_id === user.id ? "Seller" : "Buyer";
  const paymentComplete = thread.status === "PAID" || thread.status === "SETTLED";
  const paymentProblem = thread.status === "FAILED" || thread.status === "EXPIRED";

  return (
    <div className="page-container space-y-6 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader
          title={thread.title}
          description={
            thread.role === "moderator"
              ? `Moderation view of the sale between ${thread.counterparty.display_name} (@${thread.counterparty.username}) and the other party. Read-only: the team never posts here.`
              : `Private conversation with ${thread.counterparty.display_name} (@${thread.counterparty.username}) · you are the ${role.toLowerCase()}. Only the two of you can read this.`
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <TransactionBadge status={thread.status} />
          <Link
            href={`/auction/${thread.auction_id}`}
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            View the auction
          </Link>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <ReportDialog userId={thread.counterparty.id} username={thread.counterparty.username} />
        </div>
        {thread.role !== "moderator" && (
          <>
            <section aria-labelledby="sale-progress-heading" className="rounded-xl border border-border/80 bg-card p-5 shadow-sm">
              <h2 id="sale-progress-heading" className="text-sm font-semibold">What happens next</h2>
              <ol className="mt-4 grid gap-3 sm:grid-cols-4">
                <li className="rounded-lg border border-live/30 bg-live/5 p-3">
                  <span className="grid size-7 place-items-center rounded-md bg-live text-live-foreground"><Check className="size-4" aria-hidden /></span>
                  <p className="mt-2 text-sm font-semibold">Auction won</p>
                  <p className="mt-1 text-xs text-muted-foreground">The result is recorded.</p>
                </li>
                <li className={paymentComplete ? "rounded-lg border border-live/30 bg-live/5 p-3" : paymentProblem ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3" : "rounded-lg border border-primary/30 bg-primary/5 p-3"}>
                  <span className={paymentComplete ? "grid size-7 place-items-center rounded-md bg-live text-live-foreground" : "grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"}>
                    {paymentComplete ? <Check className="size-4" aria-hidden /> : <CircleDollarSign className="size-4" aria-hidden />}
                  </span>
                  <p className="mt-2 text-sm font-semibold">Payment</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {paymentComplete ? "Buyer payment is confirmed." : paymentProblem ? "Payment needs attention." : "Waiting for the buyer to pay."}
                  </p>
                </li>
                <li className={paymentComplete ? "rounded-lg border border-primary/30 bg-primary/5 p-3" : "rounded-lg border bg-muted/20 p-3"}>
                  <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground"><Handshake className="size-4" aria-hidden /></span>
                  <p className="mt-2 text-sm font-semibold">Handover</p>
                  <p className="mt-1 text-xs text-muted-foreground">{paymentComplete ? "Arrange collection or delivery here." : "Unlocks after payment is confirmed."}</p>
                </li>
                <li className="rounded-lg border bg-muted/20 p-3">
                  <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground"><Star className="size-4" aria-hidden /></span>
                  <p className="mt-2 text-sm font-semibold">Review</p>
                  <p className="mt-1 text-xs text-muted-foreground">Rate the real transaction afterwards.</p>
                </li>
              </ol>
            </section>

            <section aria-labelledby="handover-safety-heading" className="rounded-xl border border-live/25 bg-live/5 p-5">
              <h2 id="handover-safety-heading" className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-live" aria-hidden />
                Safer handover
              </h2>
              <ul className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                <li>• Prefer a busy, well-lit public place for portable items.</li>
                <li>• Meet during daylight when practical and tell someone where you are going.</li>
                <li>• Inspect the item before confirming receipt.</li>
                <li>• Keep arrangements in this BidBlitz conversation.</li>
                <li>• Never share passwords, PINs or one-time security codes.</li>
                <li>• For home pickup, have another adult present and avoid meeting alone.</li>
              </ul>
            </section>
          </>
        )}

        <MessageThread
          transactionId={thread.id}
          viewerId={user.id}
          counterpartyName={thread.counterparty.display_name}
          initial={thread.messages}
          readOnly={thread.role === "moderator"}
        />
        <p className="text-xs text-muted-foreground">
          Keep payment questions, delivery and pickup arrangements here so the
          sale has one clear record. Report suspicious messages instead of
          moving the transaction to an unknown payment link.
        </p>
      </div>
    </div>
  );
}
