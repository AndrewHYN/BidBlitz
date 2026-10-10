import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(),
  "supabase/migrations/20261010052614_high_value_payout_dual_approval_20261010.sql"), "utf8");
const component = readFileSync(join(process.cwd(),
  "src/components/dashboard/payout-approval-panel.tsx"), "utf8");
const payoutDesk = readFileSync(join(process.cwd(),
  "src/app/admin/finance/payouts/page.tsx"), "utf8");
const action = readFileSync(join(process.cwd(),
  "src/server/actions/payout-approval.ts"), "utf8");

describe("high-value payout controls", () => {
  it("requires independent approval for PAYOUT_DUE and PAID_OUT over $100", () => {
    expect(sql).toContain("new.amount_minor >= 10000");
    expect(sql).toContain("new.status in ('PAYOUT_DUE','PAID_OUT')");
    expect(sql).toContain("payout_second_approval_required");
    expect(sql).toContain("a.status='APPROVED'");
    expect(sql).toContain("a.requested_by<>a.reviewed_by");
    expect(sql).toContain("public.has_permission(a.reviewed_by,'payouts.review')");
  });

  it("denies self review and parties approving their own sales", () => {
    expect(sql).toContain("v_uid=v_req.requested_by");
    expect(sql).toContain("self_approval_forbidden");
    expect(sql).toContain("conflicted_reviewer");
    expect(sql).toContain("a.requested_by<>new.seller_id");
    expect(sql).toContain("a.reviewed_by<>new.seller_id");
  });

  it("voids stale authorizations when seller money is held or disputed", () => {
    expect(sql).toContain("new.status in ('HELD','DISPUTED','WAITING_FOR_FULFILMENT')");
    expect(sql).toContain("set status='VOIDED'");
    expect(sql).toContain("payout_approval_events");
  });

  it("keeps the approval tables select-only under staff RLS", () => {
    expect(sql).toContain("alter table public.payout_approval_requests enable row level security");
    expect(sql).toContain("revoke all on public.payout_approval_requests");
    expect(sql).toContain("for select to authenticated");
    expect(sql).not.toContain("grant insert on public.payout_approval_requests to authenticated");
  });

  it("does not call Linkwa just by clicking approval", () => {
    expect(action).toContain('requirePermission("payouts.review")');
    expect(action).toContain('requirePermission("payouts.transition")');
    expect(action).not.toContain("releaseSellerPayout");
    expect(action).not.toContain("instructLinkwaPayout");
    expect(component).toContain("You cannot approve");
  });

  it("hides the payout instruction until high-value approval is verified", () => {
    expect(payoutDesk).toContain("approvalRes.error");
    expect(payoutDesk).toContain('approval?.status === "APPROVED"');
    expect(payoutDesk).toContain("&& highValueCleared");
  });
});