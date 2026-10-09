import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, Flag, Megaphone, ReceiptText, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  EmptyState,
  PageHeader,
  SectionHeading,
} from "@/components/auction/page-header";
import { badgeVariants, SellerPayoutBadge, TransactionBadge } from "@/components/auction/status-badge";
import { Money } from "@/components/auction/money";
import { feePercentLabel } from "@/lib/money";
import { ReportStatusControls } from "@/components/dashboard/report-status-controls";
import { BanButton, TakedownButton } from "@/components/dashboard/moderation-controls";
import { Button } from "@/components/ui/button";
import {
  CancellationDecide,
  PauseResumeButtons,
  ReviewDecide,
} from "@/components/dashboard/review-decisions";
import { cancellationReasonLabel } from "@/lib/validation";
import { PayoutControls } from "@/components/dashboard/payout-controls";
import { getAdminPayouts, type AdminPayoutRow } from "@/server/queries";
import { isPaymentProviderConfigured } from "@/server/payments/config";
import { AdminNav } from "@/components/dashboard/admin-nav";
import { PromotionDecisions } from "@/components/dashboard/promotion-decisions";
import { PromotionPricing } from "@/components/dashboard/promotion-pricing";

export const metadata: Metadata = {
  title: "Admin",
  description: "Payout operations, open reports and platform fee settings on BidBlitz.",
  robots: { index: false, follow: false },
};

type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: "auction" | "user";
  target_id: string;
  reason: string;
  status: "OPEN" | "REVIEWING" | "RESOLVED" | "DISMISSED";
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
};

type ReportedAuction = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  seller_id: string;
  seller: { username: string } | null;
};

type ReportedUser = {
  id: string;
  username: string;
  display_name: string;
  is_banned: boolean;
};

type ModerationEvent = {
  id: string;
  created_at: string;
  action: "TAKEDOWN_LISTING" | "BAN_USER" | "UNBAN_USER" | "PAUSE_AUCTION" | "RESUME_AUCTION";
  target_type: "auction" | "user";
  target_id: string;
  prev_status: string | null;
  new_status: string | null;
  reason: string;
  report_id: string | null;
};

type QueueAuction = {
  id: string;
  title: string;
  status: string;
  current_bid_minor: number | null;
  bid_count: number;
  ends_at: string | null;
  starting_bid_minor: number;
  seller: { username: string } | null;
};

type PausedAuction = {
  id: string;
  title: string;
  paused_at: string | null;
  ends_at: string | null;
  bid_count: number;
};

type FeeRow = {
  id: number;
  fee_bps: number;
  min_fee_minor: number;
  currency: string;
  updated_at: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_LABELS: Record<ReportRow["status"], string> = {
  OPEN: "Open",
  REVIEWING: "In review",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

function PayoutField({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={
          emphasis
            ? "text-sm font-semibold text-foreground"
            : "text-sm font-medium text-foreground"
        }
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * One payout, read-only above the controls: the numbers come straight from
 * the frozen row, so what an operator acts on is what the database will pay.
 */
function PayoutRow({ row }: { row: AdminPayoutRow }) {
  const delivery = row.deliveryConfirmedAt
    ? `Confirmed ${formatDate(row.deliveryConfirmedAt)}`
    : "Not confirmed";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/auction/${row.auctionId}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {row.auctionTitle}
        </Link>
        <span className="text-xs text-muted-foreground">
          recorded {formatDate(row.recordedAt)}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <PayoutField label="Seller">{row.sellerName}</PayoutField>
        <PayoutField label="Buyer">{row.buyerName}</PayoutField>
        <PayoutField label="Winning price">
          <Money minor={row.grossMinor} currency={row.currency} />
        </PayoutField>
        <PayoutField label={`BidBlitz fee (${feePercentLabel(row.feeBps)})`}>
          <Money minor={row.feeMinor} currency={row.currency} />
        </PayoutField>
        <PayoutField label="Seller proceeds" emphasis>
          <Money minor={row.amountMinor} currency={row.currency} />
        </PayoutField>
        <PayoutField label="Payment status">
          <TransactionBadge status={row.transactionStatus} />
        </PayoutField>
        <PayoutField label="Payout status">
          <SellerPayoutBadge status={row.status} />
        </PayoutField>
        <PayoutField label="Linkwa recipient">
          {row.recipientOnFile ? (
            "On file"
          ) : (
            <span className="text-muted-foreground">Not on file</span>
          )}
        </PayoutField>
        <PayoutField label="Delivery">{delivery}</PayoutField>
        <PayoutField label="Payout record opened">{formatDate(row.payoutCreatedAt)}</PayoutField>
        <PayoutField label="Payout reference">
          {row.payoutReference ?? <span className="text-muted-foreground">Not recorded</span>}
        </PayoutField>
        <PayoutField label="Paid out">
          {row.paidAt ? (
            formatDate(row.paidAt)
          ) : (
            <span className="text-muted-foreground">Not paid out</span>
          )}
        </PayoutField>
        <PayoutField label="Last updated">{formatDate(row.payoutUpdatedAt)}</PayoutField>
      </dl>

      {row.internalNote && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Internal note:</span>{" "}
          {row.internalNote}
        </p>
      )}

      <PayoutControls
        payoutId={row.payoutId}
        status={row.status}
        amountMinor={row.amountMinor}
        currency={row.currency}
        deliveryConfirmedAt={row.deliveryConfirmedAt}
      />

      {row.status === "PAYOUT_PENDING" && (
        <p className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
          Automatic payout is waiting for Linkwa settlement balance or seller wallet readiness.
          Do not send a second manual payout unless you have reconciled the provider statement first.
        </p>
      )}
    </div>
  );
}

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  // Whether THIS session may operate the console: the live admin.access
  // permission, read from assignments (so revocation applies on the next page
  // load), not the legacy is_admin mirror. Every mutation below re-checks
  // inside its own RPC.
  const { data: permission } = await supabase.rpc("has_permission", {
    p_user_id: user.id,
    p_permission: "admin.access",
  });
  const isAdmin = permission === true;
  const [
    { data: canManageTeam },
    { data: canManagePromotions },
    { data: canViewDisputes },
  ] = await Promise.all([
    supabase.rpc("has_permission", {
      p_user_id: user.id,
      p_permission: "admin.manage_team",
    }),
    supabase.rpc("has_permission", {
      p_user_id: user.id,
      p_permission: "settings.manage_marketplace",
    }),
    supabase.rpc("has_permission", {
      p_user_id: user.id,
      p_permission: "disputes.view",
    }),
  ]);

  // Not an admin: say so and run NO moderation queries. The report and fee
  // reads below never execute for a caller who failed this check. The gate is
  // the live admin.access permission (assignments, not the legacy flag),
  // checked again by every mutation below.
  if (!isAdmin) {
    return (
      <div className="page-container py-10 sm:py-14" data-testid="admin-page">
        <div data-testid="admin-empty">
          <EmptyState
            icon={ShieldAlert}
            title="Admins only"
            description="This area is reserved for BidBlitz administrators."
            action={
              <Link
                href="/"
                className="text-sm font-medium text-primary hover:underline"
              >
                Back home
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  // No shared query helper exists for moderation data, so these reads are
  // caller-scoped here (RLS: reports are admin-visible, fee_settings is
  // public, seller_payouts is admin-only).
  const [reportsRes, feeRes, windowRes, payouts] = await Promise.all([
    supabase
      .from("reports")
      .select(
        "id, reporter_id, target_type, target_id, reason, status, resolution, created_at, resolved_at"
      )
      .in("status", ["OPEN", "REVIEWING"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("fee_settings")
      .select("id, fee_bps, min_fee_minor, currency, updated_at")
      .maybeSingle(),
    supabase
      .from("payment_settings")
      .select("payment_window_seconds, payments_enabled, updated_at")
      .maybeSingle(),
    getAdminPayouts(),
  ]);

  const { count: openDisputeCount } =
    canViewDisputes === true
      ? await supabase
          .from("transaction_disputes")
          .select("id", { count: "exact", head: true })
          .neq("status", "RESOLVED")
      : { count: 0 };

  const reports = (reportsRes.data ?? []) as ReportRow[];
  const fee = (feeRes.data ?? null) as FeeRow | null;
  const paymentWindow = (windowRes.data ?? null) as {
    payment_window_seconds: number;
    payments_enabled: boolean;
    updated_at: string;
  } | null;
  const configured = isPaymentProviderConfigured();
  const runtimePaymentsEnabled = paymentWindow?.payments_enabled === true;

  // What the reports point at, so the queue shows names instead of UUIDs.
  // A report target is one id in one of two tables; both reads are batched,
  // and a target deleted since the report was filed simply shows as gone
  // rather than breaking the row.
  const reportedAuctionIds = [
    ...new Set(
      reports.filter((r) => r.target_type === "auction").map((r) => r.target_id)
    ),
  ];
  const reportedUserIds = [
    ...new Set(
      reports.filter((r) => r.target_type === "user").map((r) => r.target_id)
    ),
  ];
  const [auctionRows, userRows, eventsRes] = await Promise.all([
    reportedAuctionIds.length > 0
      ? supabase
          .from("auctions")
          .select(
            "id, title, status, created_at, seller_id, seller:profiles!auctions_seller_id_fkey(username)"
          )
          .in("id", reportedAuctionIds)
      : Promise.resolve({ data: [] as ReportedAuction[] }),
    reportedUserIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, username, display_name, is_banned")
          .in("id", reportedUserIds)
      : Promise.resolve({ data: [] as ReportedUser[] }),
    supabase
      .from("moderation_events")
      .select(
        "id, created_at, action, target_type, target_id, prev_status, new_status, reason, report_id"
      )
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const auctionById = new Map(
    ((auctionRows as { data: ReportedAuction[] }).data ?? []).map((a) => [a.id, a])
  );
  const userById = new Map(
    ((userRows as { data: ReportedUser[] }).data ?? []).map((u) => [u.id, u])
  );
  const events = ((eventsRes as { data: ModerationEvent[] }).data ?? []) as ModerationEvent[];

  // The operator's incoming work beyond reports: listings waiting for a
  // human, sellers asking to end live auctions, and auctions on safety hold.
  // All three reads are admin-visible; an empty result is a quiet queue, not
  // an error. Names resolve in a second batched round through the one embed
  // whose foreign-key name is proven (`auctions_seller_id_fkey`, used by the
  // detail query), so the queue never shows bare UUIDs and never guesses at
  // constraint names.
  const [
    reviewsRes,
    cancelReqsRes,
    pausedRes,
    promotionsRes,
    promotionSettingsRes,
  ] = await Promise.all([
    supabase
      .from("listing_reviews")
      .select("id, auction_id, created_at, risk_flags")
      .eq("status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("auction_cancellation_requests")
      .select("id, auction_id, requester_id, reason_code, explanation, created_at")
      .eq("status", "PENDING")
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("auctions")
      .select("id, title, paused_at, ends_at, bid_count")
      .eq("status", "PAUSED")
      .order("paused_at", { ascending: true })
      .limit(50),
    canManagePromotions === true
      ? supabase
          .from("promotion_requests")
          .select(
            "id, auction_id, seller_id, requested_days, requested_at, quoted_price_minor, currency"
          )
          .eq("status", "PENDING")
          .order("requested_at", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: [] as unknown[] }),
    canManagePromotions === true
      ? supabase
          .from("promotion_settings")
          .select("days, price_minor, currency, enabled")
          .order("days", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  type ReviewRow = {
    id: string;
    auction_id: string;
    created_at: string;
    risk_flags: Record<string, boolean>;
  };
  type PromotionRow = {
    id: string;
    auction_id: string;
    seller_id: string;
    requested_days: number;
    requested_at: string;
    quoted_price_minor: number;
    currency: string;
  };
  type CancelRow = {
    id: string;
    auction_id: string;
    requester_id: string;
    reason_code: string;
    explanation: string | null;
    created_at: string;
  };
  const reviewRows = ((reviewsRes.data ?? []) as ReviewRow[]);
  const cancelRows = ((cancelReqsRes.data ?? []) as CancelRow[]);
  const promotionRows = ((promotionsRes.data ?? []) as PromotionRow[]);
  const promotionOffers = (promotionSettingsRes.data ?? []) as Array<{
    days: number;
    price_minor: number;
    currency: string;
    enabled: boolean;
  }>;
  const queueAuctionIds = [
    ...new Set([
      ...reviewRows.map((r) => r.auction_id),
      ...cancelRows.map((r) => r.auction_id),
      ...promotionRows.map((r) => r.auction_id),
    ]),
  ];
  const queueRequesterIds = [
    ...new Set([
      ...cancelRows.map((r) => r.requester_id),
      ...promotionRows.map((r) => r.seller_id),
    ]),
  ];
  const [queueAuctionsRes, queueUsersRes] = await Promise.all([
    queueAuctionIds.length > 0
      ? supabase
          .from("auctions")
          .select(
            "id, title, status, current_bid_minor, bid_count, ends_at, starting_bid_minor, seller:profiles!auctions_seller_id_fkey(username)"
          )
          .in("id", queueAuctionIds)
      : Promise.resolve({ data: [] as unknown[] }),
    queueRequesterIds.length > 0
      ? supabase.from("profiles").select("id, username").in("id", queueRequesterIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const queueAuctionById = new Map(
    ((queueAuctionsRes.data ?? []) as QueueAuction[]).map((a) => [a.id, a])
  );
  const queueUserById = new Map(
    ((queueUsersRes.data ?? []) as Array<{ id: string; username: string }>).map((u) => [
      u.id,
      u,
    ])
  );
  const pendingReviews = reviewRows.map((r) => ({
    ...r,
    auction: queueAuctionById.get(r.auction_id) ?? null,
  }));
  const cancelRequests = cancelRows.map((r) => ({
    ...r,
    auction: queueAuctionById.get(r.auction_id) ?? null,
    requester: queueUserById.get(r.requester_id) ?? null,
  }));
  const pausedAuctions = ((pausedRes.data ?? []) as PausedAuction[]);
  const pendingPromotions = promotionRows.map((r) => ({
    ...r,
    auction: queueAuctionById.get(r.auction_id) ?? null,
    seller: queueUserById.get(r.seller_id) ?? null,
  }));

  return (
    <div className="page-container py-10 sm:py-14 space-y-8" data-testid="admin-page">
      <PageHeader
        title="Admin"
        description="Review marketplace work, promotions, safety actions and money operations from one console."
      />

      <AdminNav
        active="overview"
        showTeam={canManageTeam === true}
        disputeCount={openDisputeCount ?? 0}
      />

      {canManagePromotions === true && (
        <section id="admin-promotions" aria-labelledby="admin-promotions-heading" className="space-y-4 scroll-mt-24">
          <SectionHeading
            title={
              <span id="admin-promotions-heading" className="inline-flex items-center gap-2">
                <Megaphone className="size-4 text-primary" aria-hidden />
                Promotion requests
                {pendingPromotions.length > 0 && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground" data-numeric>
                    {pendingPromotions.length}
                  </span>
                )}
              </span>
            }
          />
          <div className="promotion-surface rounded-2xl border border-primary/15 p-4 sm:p-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Promotion changes visibility only. Approving a request never changes bidding, timing, settlement or who wins.
              Prices below are future quotes only. Existing seller requests keep the price they saw when requesting.
            </p>
            <div className="mt-4">
              <PromotionPricing
                offers={promotionOffers
                  .filter((offer) => offer.days === 3 || offer.days === 7)
                  .map((offer) => ({
                    days: offer.days as 3 | 7,
                    priceMinor: offer.price_minor,
                    enabled: offer.enabled,
                  }))}
              />
            </div>
            <div className="my-5 border-t" />
            {pendingPromotions.length === 0 ? (
              <EmptyState
                compact
                icon={Megaphone}
                title="No promotion requests"
                description="Seller requests for extra placement appear here."
              />
            ) : (
              <ul className="space-y-3">
                {pendingPromotions.map((request) => (
                  <li key={request.id} className="rounded-xl border bg-background p-4 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {request.auction?.title ?? "Auction"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          @{request.seller?.username ?? "seller"} · {request.requested_days} days ·{" "}
                          <span className="font-semibold text-foreground" data-numeric>
                            <Money minor={request.quoted_price_minor} currency={request.currency} />
                          </span>{" "}
                          quoted · requested {formatDate(request.requested_at)}
                        </p>
                      </div>
                      {request.auction && (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/auction/${request.auction.id}`}>Inspect auction</Link>
                        </Button>
                      )}
                    </div>
                    <PromotionDecisions requestId={request.id} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="admin-payouts-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="admin-payouts-heading" className="inline-flex items-center gap-2">
              <Banknote className="size-4 text-muted-foreground" aria-hidden />
              Payout operations
            </span>
          }
        />

        <div className="space-y-3 rounded-xl border bg-card p-4 text-sm leading-relaxed shadow-sm sm:p-5">
          <p className="text-xs text-muted-foreground">
            A payout record appears here the moment the payment provider confirms a buyer&apos;s
            payment. It freezes the seller&apos;s proceeds and then follows its own
            workflow. It is <strong className="text-foreground">not</strong> the payment
            status. <em>Record seller payout</em> means the transfer was already made
            outside BidBlitz and you are recording its reference. <em>Instruct seller payout
            with Linkwa</em> is available in the Finance payout desk only after all
            payment, wallet and handover checks pass and payments are enabled.
            Provider acknowledgement still requires independent reconciliation.
          </p>

          <div data-testid="admin-payouts">
            {/*
              A queue, not a set of cards.

              Each payout was a shadowed card with 16px of space around it, so
              an operator working a backlog of twenty payouts was scrolling past
              twenty floating islands rather than reading a list. The frame
              stays — a queue row still needs an edge you can scan down — but the
              drop shadow goes, and the rows sit closer together so the eye can
              compare them. Density is what an operations console is for; a
              consumer-style card per row is the opposite.

              NOT VISUALLY VERIFIED: /admin needs the owner's own credentials,
              which are never handled here, so this is reviewed from source and
              from the non-admin refusal path. It should be looked at on the
              first real payout before it is trusted.
            */}
            {payouts.length === 0 ? (
              <EmptyState
                compact
                icon={Banknote}
                title="No payouts yet"
                description="A row appears once a buyer's payment has been confirmed."
              />
            ) : (
              <ul className="space-y-2">
                {payouts.map((row) => (
                  <li
                    key={row.payoutId}
                    data-testid="admin-payout-row"
                    className="rounded-lg border bg-background p-4"
                  >
                    <PayoutRow row={row} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="admin-reports-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="admin-reports-heading" className="inline-flex items-center gap-2">
              <Flag className="size-4 text-muted-foreground" aria-hidden />
              Open reports
              {reports.length > 0 && (
                <span
                  className="rounded-full bg-ending px-2 py-0.5 text-xs font-medium text-ending-foreground"
                  data-numeric
                >
                  {reports.length}
                </span>
              )}
            </span>
          }
        />

        <div data-testid="admin-reports" className="space-y-3">
          {reportsRes.error ? (
            <p role="alert" className="text-sm text-destructive">
              Reports could not be loaded: {reportsRes.error.message}
            </p>
          ) : reports.length === 0 ? (
            <EmptyState
              compact
              icon={Flag}
              title="No open reports"
              description="Reports filed by users appear here while they are open or under review."
            />
          ) : (
            <ul className="space-y-2">
              {reports.map((report) => {
                const auction =
                  report.target_type === "auction"
                    ? auctionById.get(report.target_id)
                    : undefined;
                const reportedUser =
                  report.target_type === "user"
                    ? userById.get(report.target_id)
                    : undefined;
                return (
                  <li
                    key={report.id}
                    data-testid="admin-report-row"
                    className="space-y-3 rounded-lg border bg-card p-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            report.status === "OPEN"
                              ? badgeVariants({ tone: "ending" })
                              : badgeVariants({ tone: "scheduled" })
                          }
                        >
                          {STATUS_LABELS[report.status]}
                        </span>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">
                          {report.target_type === "auction" ? "Auction" : "User"} report
                        </span>
                      </div>
                      {/*
                        The target as a name and a link, never a bare UUID. An
                        operator cannot act on 36 hex characters; a missing
                        target (deleted since the report) says so instead of
                        breaking the row.
                      */}
                      {report.target_type === "auction" ? (
                        auction ? (
                          <p className="text-sm">
                            <Link
                              href={`/auction/${auction.id}`}
                              className="font-medium hover:text-primary hover:underline"
                            >
                              {auction.title}
                            </Link>{" "}
                            <span className="text-muted-foreground">
                              by {auction.seller?.username ?? "unknown seller"} ·{" "}
                              {auction.status} · listed {formatDate(auction.created_at)}
                            </span>
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            The reported listing no longer exists.
                          </p>
                        )
                      ) : reportedUser ? (
                        <p className="text-sm">
                          <Link
                            href={`/profile/${reportedUser.username}`}
                            className="font-medium hover:text-primary hover:underline"
                          >
                            @{reportedUser.username}
                          </Link>{" "}
                          <span className="text-muted-foreground">
                            {reportedUser.display_name}
                            {reportedUser.is_banned ? " · currently suspended" : ""}
                          </span>
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          The reported account no longer exists.
                        </p>
                      )}
                      <p className="text-sm font-medium">{report.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        Filed {formatDate(report.created_at)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      <ReportStatusControls
                        reportId={report.id}
                        status={report.status}
                      />
                      {/*
                        Enforcement lives beside triage, not on another page:
                        the operator reading the reason is the operator
                        deciding. Each button confirms with the target named
                        and writes the audit row; the RPC underneath refuses
                        anything already closed, so a stale queue cannot
                        double-enforce.
                      */}
                      {report.target_type === "auction" && auction &&
                        (auction.status === "LIVE" || auction.status === "SCHEDULED") && (
                          <TakedownButton
                            auctionId={auction.id}
                            auctionTitle={auction.title}
                            reportId={report.id}
                          />
                        )}
                      {report.target_type === "auction" && auction &&
                        auction.status === "LIVE" && (
                          <PauseResumeButtons
                            auctionId={auction.id}
                            auctionTitle={auction.title}
                            paused={false}
                          />
                        )}
                      {report.target_type === "user" && reportedUser && (
                        <BanButton
                          userId={reportedUser.id}
                          username={reportedUser.username}
                          banned={reportedUser.is_banned}
                          reportId={report.id}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="admin-review-heading" className="space-y-4 scroll-mt-24">
        <SectionHeading
          title={
            <span id="admin-review-heading" className="inline-flex items-center gap-2">
              <Flag className="size-4 text-muted-foreground" aria-hidden />
              Listing review
              {pendingReviews.length > 0 && (
                <span
                  className="rounded-full bg-ending px-2 py-0.5 text-xs font-medium text-ending-foreground"
                  data-numeric
                >
                  {pendingReviews.length}
                </span>
              )}
            </span>
          }
        />

        <div data-testid="admin-reviews" className="space-y-3">
          {reviewsRes.error ? (
            <p role="alert" className="text-sm text-destructive">
              Reviews could not be loaded: {reviewsRes.error.message}
            </p>
          ) : pendingReviews.length === 0 ? (
            <EmptyState
              compact
              icon={Flag}
              title="No listings waiting"
              description="First and flagged listings appear here before they can go public."
            />
          ) : (
            <ul className="space-y-2">
              {pendingReviews.map((review) => (
                <li
                  key={review.id}
                  data-testid="admin-review-row"
                  className="space-y-3 rounded-lg border bg-card p-4"
                >
                  <div className="space-y-1">
                    {review.auction ? (
                      <p className="text-sm">
                        <Link
                          href={`/sell/${review.auction.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {review.auction.title}
                        </Link>{" "}
                        <span className="text-muted-foreground">
                          by {review.auction.seller?.username ?? "unknown seller"} ·{" "}
                          <Money
                            minor={review.auction.starting_bid_minor}
                            currency="USD"
                          />{" "}
                          starting bid · filed {formatDate(review.created_at)}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        The listed auction no longer exists.
                      </p>
                    )}
                    {Object.keys(review.risk_flags ?? {}).length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Held for: {Object.keys(review.risk_flags).join(", ")}.
                      </p>
                    )}
                  </div>
                  <div className="border-t pt-3">
                    <ReviewDecide reviewId={review.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="admin-cancellations-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="admin-cancellations-heading" className="inline-flex items-center gap-2">
              <Flag className="size-4 text-muted-foreground" aria-hidden />
              Cancellation requests
              {cancelRequests.length > 0 && (
                <span
                  className="rounded-full bg-ending px-2 py-0.5 text-xs font-medium text-ending-foreground"
                  data-numeric
                >
                  {cancelRequests.length}
                </span>
              )}
            </span>
          }
        />

        <div data-testid="admin-cancellations" className="space-y-3">
          {cancelRequests.length === 0 ? (
            <EmptyState
              compact
              icon={Flag}
              title="No pending requests"
              description="Sellers asking to end live auctions with bids appear here."
            />
          ) : (
            <ul className="space-y-2">
              {cancelRequests.map((request) => (
                <li
                  key={request.id}
                  data-testid="admin-cancellation-row"
                  className="space-y-3 rounded-lg border bg-card p-4"
                >
                  <div className="space-y-1">
                    {request.auction ? (
                      <p className="text-sm">
                        <Link
                          href={`/auction/${request.auction.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          {request.auction.title}
                        </Link>{" "}
                        <span className="text-muted-foreground">
                          {request.auction.bid_count} bid
                          {request.auction.bid_count === 1 ? "" : "s"}
                          {request.auction.current_bid_minor !== null && (
                            <>
                              {" · "}
                              <Money
                                minor={request.auction.current_bid_minor}
                                currency="USD"
                              />{" "}
                              top bid
                            </>
                          )}{" "}
                          · {request.auction.status}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        The auction no longer exists.
                      </p>
                    )}
                    <p className="text-sm font-medium">
                      {cancellationReasonLabel(request.reason_code)}
                      {request.requester && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · @{request.requester.username}
                        </span>
                      )}
                    </p>
                    {request.explanation && (
                      <p className="text-sm text-muted-foreground">{request.explanation}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Filed {formatDate(request.created_at)}
                    </p>
                  </div>
                  <div className="border-t pt-3">
                    <CancellationDecide requestId={request.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="admin-paused-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="admin-paused-heading" className="inline-flex items-center gap-2">
              <Flag className="size-4 text-muted-foreground" aria-hidden />
              Paused auctions
              {pausedAuctions.length > 0 && (
                <span
                  className="rounded-full bg-ending px-2 py-0.5 text-xs font-medium text-ending-foreground"
                  data-numeric
                >
                  {pausedAuctions.length}
                </span>
              )}
            </span>
          }
        />

        <div data-testid="admin-paused" className="space-y-3">
          {pausedAuctions.length === 0 ? (
            <EmptyState
              compact
              icon={Flag}
              title="Nothing on hold"
              description="Auctions paused for safety review appear here until resumed or cancelled."
            />
          ) : (
            <ul className="space-y-2">
              {pausedAuctions.map((auction) => (
                <li
                  key={auction.id}
                  data-testid="admin-paused-row"
                  className="space-y-3 rounded-lg border bg-card p-4"
                >
                  <p className="text-sm">
                    <Link
                      href={`/auction/${auction.id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {auction.title}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      {auction.bid_count} bid{auction.bid_count === 1 ? "" : "s"} · held
                      since {auction.paused_at ? formatDate(auction.paused_at) : "unknown"}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <PauseResumeButtons
                      auctionId={auction.id}
                      auctionTitle={auction.title}
                      paused
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="admin-audit-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="admin-audit-heading" className="inline-flex items-center gap-2">
              <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
              Moderation record
            </span>
          }
        />

        {/*
          What happened, as the database recorded it: every takedown and every
          suspension, with the actor implied (only admins can write here), the
          reason, and the time. Append-only by construction - no update or
          delete policy exists for any role - so this list can only grow. A
          seller asking "why was my listing removed" gets an answer from this
          list, not a guess.
        */}
        <div data-testid="admin-audit" className="space-y-3">
          {events.length === 0 ? (
            <EmptyState
              compact
              icon={ShieldAlert}
              title="No enforcement actions yet"
              description="Takedowns and suspensions appear here with the reason recorded."
            />
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  data-testid="admin-audit-row"
                  className="space-y-1 rounded-lg border bg-card p-4"
                >
                  <p className="text-sm">
                    <span className="font-medium">
                      {event.action === "TAKEDOWN_LISTING"
                        ? "Listing taken down"
                        : event.action === "BAN_USER"
                          ? "Account suspended"
                          : "Account restored"}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {event.target_type === "auction" ? (
                        <Link
                          href={`/auction/${event.target_id}`}
                          className="hover:text-primary hover:underline"
                        >
                          listing
                        </Link>
                      ) : (
                        "account"
                      )}{" "}
                      · {formatDate(event.created_at)}
                    </span>
                  </p>
                  {(event.prev_status || event.new_status) && (
                    <p className="text-xs text-muted-foreground">
                      {event.prev_status ?? "?"} → {event.new_status ?? "?"}
                    </p>
                  )}
                  <p className="text-sm">{event.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="admin-fee-heading" className="space-y-4">
        <SectionHeading
          title={
            <span id="admin-fee-heading" className="inline-flex items-center gap-2">
              <ReceiptText className="size-4 text-muted-foreground" aria-hidden />
              Platform fee
            </span>
          }
        />

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          {fee ? (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Fee rate
                </dt>
                <dd className="text-lg font-semibold" data-numeric>
                  {fee.fee_bps} bps
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Minimum fee
                </dt>
                <dd className="text-lg font-semibold">
                  <Money minor={fee.min_fee_minor} currency={fee.currency} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </dt>
                <dd className="text-sm font-medium">{formatDate(fee.updated_at)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No fee settings row is present, so the engine falls back to its
              built-in default of 500 bps with no minimum.
            </p>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            {!configured
              ? "No payment provider is configured, so BidBlitz cannot start new money movement."
              : runtimePaymentsEnabled
                ? "The payment provider is configured and the runtime payment switch is ON."
                : "The payment provider is configured, but the runtime payment switch is OFF. New checkout and seller payout instructions remain paused."}
          </p>
          <div className="mt-4 border-t border-border/70 pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Payment window
            </p>
            {paymentWindow ? (
              <p className="mt-1 text-sm">
                <span className="font-semibold" data-numeric>
                  {Math.round(paymentWindow.payment_window_seconds / 3600)} hours
                </span>{" "}
                <span className="text-muted-foreground">
                  to pay before an unpaid sale expires. Changed only by
                  privileged SQL against payment_settings, never by the client.
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No payment window is configured yet, so unpaid sales do not
                expire. Apply the payment-deadline migration, then set
                payment_settings.payment_window_seconds.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
