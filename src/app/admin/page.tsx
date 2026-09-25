import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Flag, ReceiptText, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  EmptyState,
  PageHeader,
  SectionHeading,
} from "@/components/auction/page-header";
import { badgeVariants } from "@/components/auction/status-badge";
import { Money } from "@/components/auction/money";
import { ReportStatusControls } from "@/components/dashboard/report-status-controls";
import { isPaymentConfigured } from "@/server/payments/provider";

export const metadata: Metadata = {
  title: "Admin",
  description: "Open reports and platform fee settings on BidBlitz.",
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

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  // Same fact the old `is_admin()` RPC returned: whether THIS session's user
  // carries the admin flag. Read straight from the profile row (RLS: everyone
  // may read profiles), because migration 000010 moved that function out of
  // the exposed API schema.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.is_admin ?? false;

  // Not an admin: say so and run NO moderation queries. The report and fee
  // reads below never execute for a caller who failed this check.
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

  // No shared query helper exists for moderation data, so these two reads are
  // caller-scoped here (RLS: reports are admin-visible, fee_settings is public).
  const [reportsRes, feeRes] = await Promise.all([
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
  ]);

  const reports = (reportsRes.data ?? []) as ReportRow[];
  const fee = (feeRes.data ?? null) as FeeRow | null;
  const configured = isPaymentConfigured();

  return (
    <div className="page-container py-10 sm:py-14 space-y-8" data-testid="admin-page">
      <PageHeader
        title="Admin"
        description="Open moderation reports and the platform fee currently in force."
      />

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
            <ul className="space-y-3">
              {reports.map((report) => (
                <li
                  key={report.id}
                  data-testid="admin-report-row"
                  className="space-y-3 rounded-xl border bg-card p-4 shadow-sm"
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
                    <p className="text-sm font-medium">{report.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Target {report.target_id} · filed {formatDate(report.created_at)}
                    </p>
                  </div>

                  <ReportStatusControls
                    reportId={report.id}
                    status={report.status}
                  />
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
            {configured
              ? "A payment provider is configured; settled sales can move money."
              : "No payment provider is configured yet, so no money has moved. Fees here are what WOULD be charged on settlement."}
          </p>
        </div>
      </section>
    </div>
  );
}
