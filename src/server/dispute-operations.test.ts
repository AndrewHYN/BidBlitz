import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(),"supabase/migrations/20261010053520_dispute_staff_case_ops_20261010.sql"),"utf8");
const actions = readFileSync(join(process.cwd(),"src/server/actions/dispute-operations.ts"),"utf8");
const panel = readFileSync(join(process.cwd(),"src/components/dashboard/dispute-operations-panel.tsx"),"utf8");
const staffPage = readFileSync(join(process.cwd(),"src/app/admin/disputes/[id]/page.tsx"),"utf8");
const buyerCase = readFileSync(join(process.cwd(),"src/server/disputes.ts"),"utf8");

describe("staff dispute case workspaces", () => {
  it("records private notes separately from buyer and seller messages", () => {
    expect(sql).toContain("public.dispute_ops_events");
    expect(sql).toContain("p_note");
    expect(sql).toContain("'INTERNAL_NOTE'");
    expect(sql).not.toContain("insert into public.transaction_dispute_messages");
    expect(actions).toContain('requirePermission("disputes.manage")');
    expect(panel).toContain("Buyers and sellers cannot see it");
  });
  it("forces private records through RLS and RPCs, not client table writes", () => {
    expect(sql).toContain("alter table public.dispute_ops_cases enable row level security");
    expect(sql).toContain("alter table public.dispute_ops_events enable row level security");
    expect(sql).toContain("revoke all on public.dispute_ops_cases,public.dispute_ops_events");
    expect(sql).toContain("for select to authenticated");
    expect(sql).toContain("public.has_permission(auth.uid(),'disputes.manage')");
    expect(sql).not.toContain("grant insert on public.dispute_ops_events to authenticated");
  });
  it("requires a genuinely authorized active assignee and an open dispute", () => {
    expect(sql).toContain("public.has_permission(p_assignee,'disputes.manage')");
    expect(sql).toContain("v_status='RESOLVED'");
    expect(sql).toContain("for update");
    expect(sql).toContain("p_target_hours not in (24,48,72)");
  });
  it("keeps staff details out of the buyer or seller case fetch", () => {
    expect(buyerCase).not.toContain("dispute_ops_events");
    expect(buyerCase).not.toContain("dispute_ops_cases");
    expect(staffPage).toContain("canManageDisputes &&");
  });
  it("never issues money or changes dispute resolution in case owner actions", () => {
    expect(actions).not.toContain("releaseSellerPayout");
    expect(actions).not.toContain("staff_update_transaction_dispute");
    expect(sql).not.toContain("update public.seller_payouts");
    expect(sql).not.toContain("update public.transaction_disputes");
  });
  it("rejects missing notes and surfaces unavailable operations separately", () => {
    expect(actions).toContain("z.string().trim().min(10).max(3000)");
    expect(staffPage).toContain("opsUnavailable");
    expect(panel).toContain("Internal activity timeline");
  });
});