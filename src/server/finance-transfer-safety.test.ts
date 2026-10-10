import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function file(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}
const migration = file("supabase/migrations/20261010133624_finance_payout_reconciliation_lock_20261010.sql");
const service = file("src/server/payments/seller-payout.ts");
const runtime = file("src/server/payments/runtime.ts");
const desk = file("src/app/admin/finance/payouts/page.tsx");
const costs = file("src/app/admin/finance/costs/page.tsx");
const payments = file("src/app/admin/finance/payments/page.tsx");
const external = file("src/components/dashboard/external-payout-panel.tsx");

describe("finance transfer safety release", () => {
  it("locks provider payouts separately from valid buyer checkout", () => {
    expect(migration).toContain("linkwa_payout_instructions_enabled boolean not null default false");
    expect(runtime).toContain("linkwaPayoutInstructionsEnabled");
    expect(runtime).toContain("linkwa_payout_instructions_enabled === true");
    expect(service).toContain("if (!(await linkwaPayoutInstructionsEnabled()))");
    expect(service.indexOf("linkwaPayoutInstructionsEnabled()))")).toBeLessThan(service.indexOf("const admin = createAdminClient();"));
    expect(desk).toContain("&& linkwaDirectEnabled && triage");
  });

  it("has an audit-only evidence RPC and locks ambiguous claims", () => {
    expect(migration).toContain("create table if not exists public.seller_payout_reconciliation_evidence");
    expect(migration).toContain("alter table public.seller_payout_reconciliation_evidence enable row level security");
    expect(migration).toContain("payout_not_under_reconciliation");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("'payouts.mark_paid'");
    expect(migration).toContain("seller_receipt_verified=true");
    expect(migration).toContain("verified_seller_receipt_evidence_required");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).not.toContain("update public.seller_payouts set status='PAYOUT_PENDING'");
    expect(desk).toContain("<PayoutReconciliationPanel");
  });

  it("provides copyable external transfer details without sending a transfer", () => {
    expect(external).toContain("<FinanceTransferSlip");
    expect(costs).toContain("<FinanceTransferSlip");
    expect(payments).toContain("Review seller settlement");
    expect(file("src/components/dashboard/finance-transfer-slip.tsx")).toContain("navigator.clipboard.writeText");
    expect(file("src/components/dashboard/finance-transfer-slip.tsx")).not.toContain("instructLinkwaPayout");
  });
});
