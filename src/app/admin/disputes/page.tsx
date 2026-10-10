import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleAlert, Scale, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission } from "@/server/permissions";
import { PageHeader, EmptyState } from "@/components/auction/page-header";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { DisputeStatusBadge } from "@/components/dashboard/dispute-status-badge";
import { disputeReasonLabel } from "@/lib/disputes";
import type { DisputeReason, DisputeStatus } from "@/lib/supabase/types";

export const metadata: Metadata = {
  title: "Dispute queue",
  description: "Buyer and seller transaction disputes requiring BidBlitz review.",
  robots: { index: false, follow: false },
};

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AdminDisputesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/disputes");

  const [canView, canManageTeam, canManageDisputes] = await Promise.all([
    hasPermission(user.id, "disputes.view"),
    hasPermission(user.id, "admin.manage_team"),
    hasPermission(user.id, "disputes.manage"),
  ]);
  if (!canView) redirect("/");

  const admin = createAdminClient();
  const { data: disputes, error: disputeQueryError } = await admin
    .from("transaction_disputes")
    .select(
      "id, transaction_id, opened_by, reason, status, payout_status_at_open, payout_frozen, created_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(100);

  const opsRes = canManageDisputes && (disputes ?? []).length > 0
    ? await supabase.from("dispute_ops_cases")
        .select("dispute_id, assigned_to, priority, next_action_at")
        .in("dispute_id", (disputes ?? []).map((d) => d.id))
    : { data: [], error: null };
  type OpsRow = { dispute_id: string; assigned_to: string; priority: string; next_action_at: string };
  const opsById = new Map<string, OpsRow>(
    ((opsRes.data ?? []) as OpsRow[]).map((row) => [row.dispute_id, row])
  );

  const rows = disputes ?? [];
  const activeCount = rows.filter((row) => row.status !== "RESOLVED").length;
  const transactionIds = [...new Set(rows.map((row) => row.transaction_id))];
  const { data: txs } =
    transactionIds.length > 0
      ? await admin
          .from("transactions")
          .select("id, auction_id, buyer_id, seller_id, gross_minor, currency")
          .in("id", transactionIds)
      : { data: [] };
  const auctionIds = [...new Set((txs ?? []).map((tx) => tx.auction_id))];
  const userIds = [
    ...new Set(
      (txs ?? []).flatMap((tx) => [tx.buyer_id, tx.seller_id])
    ),
  ];
  const [{ data: auctions }, { data: profiles }] = await Promise.all([
    auctionIds.length > 0
      ? admin.from("auctions").select("id, title").in("id", auctionIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
    userIds.length > 0
      ? admin.from("profiles").select("id, username, display_name").in("id", userIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; username: string; display_name: string }>,
        }),
  ]);

  const txById = new Map((txs ?? []).map((tx) => [tx.id, tx]));
  const auctionById = new Map((auctions ?? []).map((auction) => [auction.id, auction]));
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return (
    <div className="page-container space-y-7 py-10 sm:py-14">
      <PageHeader
        title="Dispute queue"
        description="Cases involving paid sales. Review the timeline, evidence and payout state before making a decision."
      />
      <AdminNav
        active="disputes"
        showTeam={canManageTeam}
        disputeCount={activeCount}
      />

      <section className="case-queue-banner relative overflow-hidden rounded-2xl border p-5 shadow-lg sm:p-6">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
              <Scale className="size-4" aria-hidden />
              Transaction safety
            </div>
            <h2 className="mt-2 text-xl font-bold tracking-tight">
              {activeCount === 0
                ? "No open cases"
                : `${activeCount} case${activeCount === 1 ? "" : "s"} need attention`}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Opening a dispute can freeze an unpaid seller payout. A case decision records responsibility and the payout action, but never fabricates a refund.
            </p>
          </div>
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl border bg-background/80 text-primary shadow-sm">
            {activeCount > 0 ? (
              <CircleAlert className="size-6" aria-hidden />
            ) : (
              <ShieldCheck className="size-6" aria-hidden />
            )}
          </span>
        </div>
      </section>

      {disputeQueryError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm font-semibold text-destructive">
          The dispute worklist could not be loaded. Do not interpret this as a cleared queue.
        </p>
      )}
      {canManageDisputes && opsRes.error && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm font-semibold text-destructive">
          Private staff assignments are currently unavailable. Case status data is shown without ownership details.
        </p>
      )}

      {!disputeQueryError && (rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No disputes"
          description="Buyer and seller cases appear here as soon as they are opened."
        />
      ) : (
        <div className="grid gap-3">
          {rows.map((dispute) => {
            const tx = txById.get(dispute.transaction_id);
            const auction = tx ? auctionById.get(tx.auction_id) : null;
            const buyer = tx ? profileById.get(tx.buyer_id) : null;
            const seller = tx ? profileById.get(tx.seller_id) : null;
            return (
              <Link
                key={dispute.id}
                href={`/admin/disputes/${dispute.id}`}
                className="case-list-card group rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <DisputeStatusBadge status={dispute.status as DisputeStatus} />
                      {canManageDisputes && opsById.has(dispute.id) && (
                        <span className="rounded-md border border-orange-500/25 bg-orange-500/10 px-2 py-1 text-[11px] font-bold text-orange-700 dark:text-orange-300">
                          {opsById.get(dispute.id)?.priority} priority
                        </span>
                      )}
                      {canManageDisputes && dispute.status !== "RESOLVED"
                        && opsById.get(dispute.id)?.next_action_at
                        && new Date(opsById.get(dispute.id)!.next_action_at).getTime() < Date.now() && (
                          <span className="rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1 text-[11px] font-bold text-destructive">
                            Staff review overdue
                          </span>
                        )}
                      {dispute.payout_frozen && (
                        <span className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">
                          Payout frozen
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 truncate text-lg font-bold">
                      {auction?.title ?? "Sale"}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {disputeReasonLabel(dispute.reason as DisputeReason)}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Buyer: {buyer?.display_name ?? "Unknown"} · Seller: {seller?.display_name ?? "Unknown"}
                    </p>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
                    <p>Updated {formatStamp(dispute.updated_at)}</p>
                    <p className="mt-1">Payout at open: {dispute.payout_status_at_open ?? "none"}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      )}
    </div>
  );
}
