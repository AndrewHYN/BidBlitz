import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { DisputeStatusBadge } from "@/components/dashboard/dispute-status-badge";
import { disputeReasonLabel } from "@/lib/disputes";
import type { DisputeReason, DisputeStatus } from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "Disputes",
  description: "Transaction disputes you opened or are responding to.",
  robots: { index: false, follow: false },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function DisputesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/disputes");

  // Use the admin reader only after resolving the authenticated user. We filter
  // to transactions where this user is actually buyer/seller so a staff member
  // visiting their personal dashboard does not see the staff dispute queue.
  const admin = createAdminClient();
  const { data: txs } = await admin
    .from("transactions")
    .select("id, auction_id, buyer_id, seller_id")
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

  const transactionIds = (txs ?? []).map((tx) => tx.id);
  if (transactionIds.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Disputes"
          description="Cases attached to paid sales where you are the buyer or seller."
        />
        <EmptyState
          icon={ShieldAlert}
          title="No disputes"
          description="If a paid sale has a serious handover, item or money problem, you can open a case from the sale conversation."
        />
      </div>
    );
  }

  const { data: disputes } = await admin
    .from("transaction_disputes")
    .select("id, transaction_id, reason, status, created_at, updated_at")
    .in("transaction_id", transactionIds)
    .order("updated_at", { ascending: false });

  const txById = new Map((txs ?? []).map((tx) => [tx.id, tx]));
  const auctionIds = [...new Set((txs ?? []).map((tx) => tx.auction_id))];
  const { data: auctions } =
    auctionIds.length > 0
      ? await admin.from("auctions").select("id, title").in("id", auctionIds)
      : { data: [] };
  const auctionById = new Map((auctions ?? []).map((auction) => [auction.id, auction.title]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disputes"
        description="Cases attached to paid sales where you are the buyer or seller."
      />

      {(disputes ?? []).length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No disputes"
          description="If a paid sale has a serious handover, item or money problem, open the transaction and choose Open dispute."
        />
      ) : (
        <div className="grid gap-3">
          {(disputes ?? []).map((dispute) => {
            const tx = txById.get(dispute.transaction_id);
            const title = tx ? auctionById.get(tx.auction_id) : null;
            const role = tx?.buyer_id === user.id ? "Buyer" : "Seller";
            return (
              <Link
                key={dispute.id}
                href={`/dashboard/disputes/${dispute.id}`}
                className="case-list-card group rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <DisputeStatusBadge status={dispute.status as DisputeStatus} />
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {role}
                      </span>
                    </div>
                    <h2 className="mt-3 truncate text-lg font-bold tracking-tight">
                      {title ?? "Sale"}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {disputeReasonLabel(dispute.reason as DisputeReason)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Updated {formatDate(dispute.updated_at)}</p>
                    <p className="mt-1">Opened {formatDate(dispute.created_at)}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
