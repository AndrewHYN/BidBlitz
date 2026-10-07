import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircleOff, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getThread } from "@/server/queries";
import { PageHeader } from "@/components/auction/page-header";
import { TransactionBadge } from "@/components/auction/status-badge";
import { MessageThread } from "@/components/dashboard/message-thread";
import { ReportDialog } from "@/components/auction/report-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDeliveryButton } from "@/components/dashboard/confirm-delivery-button";

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
  const { data: payoutStates } = await supabase.rpc("my_transaction_payout_states");
  const payoutState = (payoutStates ?? []).find(
    (row) => row.transaction_id === thread.id
  );
  const buyerMayConfirm =
    thread.role !== "moderator" &&
    thread.seller_id !== user.id &&
    (thread.status === "PAID" || thread.status === "SETTLED") &&
    payoutState !== undefined &&
    !["HELD", "DISPUTED"].includes(payoutState.payout_status);

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
        {buyerMayConfirm && payoutState && (
          <div className="promotion-surface rounded-xl border border-primary/20 p-4 shadow-sm">
            <p className="font-semibold">Received the item?</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Confirm only after the item has been handed over and you are satisfied with the handover. Confirmation releases the seller&apos;s payout if their wallet is ready.
            </p>
            <div className="mt-3">
              <ConfirmDeliveryButton
                transactionId={thread.id}
                confirmed={Boolean(payoutState.delivery_confirmed_at)}
              />
            </div>
          </div>
        )}

        {thread.role !== "moderator" && (
          <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-semibold">Keep the handover safe</p>
              <p className="mt-1 leading-6 text-muted-foreground">
                Keep arrangements in this thread. For collection, use a busy public place during daylight when practical, inspect the item before leaving, and never share passwords, PINs or one-time codes.
              </p>
            </div>
          </div>
        )}

        <MessageThread
          transactionId={thread.id}
          viewerId={user.id}
          counterpartyName={thread.counterparty.display_name}
          initial={thread.messages}
          readOnly={thread.role === "moderator"}
        />
        <p className="text-xs text-muted-foreground">
          Arrange payment questions, delivery or pickup here rather than by
          email: this thread stays with the sale. Never share anything you
          would not want the BidBlitz team to see. Reported messages are
          reviewed by a person.
        </p>
      </div>
    </div>
  );
}
