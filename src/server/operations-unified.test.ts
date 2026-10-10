import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");
const expenseSql=read("supabase/migrations/20261010121000_company_costs_staff_ledger.sql");
const supportSql=read("supabase/migrations/20261010121500_support_desk.sql");
const reviewSql=read("supabase/migrations/20261010122000_staff_listing_approval.sql");
const supportAction=read("src/server/actions/support-tickets.ts");
const reviewAction=read("src/server/actions/staff-listing-review.ts");
const readiness=read("src/app/admin/finance/readiness/page.tsx");
const finance=read("src/app/admin/finance/costs/page.tsx");

describe("unified BidBlitz operations security contracts",()=>{
 it("company expenses never mutate seller liabilities or payment fees",()=>{
  expect(expenseSql).toContain("public.company_operating_costs");
  expect(expenseSql).toContain("public.company_operating_cost_events");
  expect(expenseSql).toContain("public.has_permission(v_uid,'finance.costs.manage')");
  expect(expenseSql).toContain("external_reference");
  expect(expenseSql).not.toContain("update public.seller_payouts");
  expect(expenseSql).not.toContain("update public.transactions");
  expect(expenseSql).not.toContain("update public.fee_settings");
  expect(expenseSql).not.toContain("update public.payment_settings");
 });
 it("company costs require external proof for PAID and exact cents",()=>{
  expect(expenseSql).toContain("paid_reference_required");
  expect(expenseSql).toContain("amount_minor bigint");
  expect(finance).toContain("company-costs-page");
  expect(read("src/lib/finance/costs.ts")).toContain("parseMoneyToMinor");
 });
 it("support staff notes are separate from customer-visible replies",()=>{
  expect(supportSql).toContain("public.support_staff_notes");
  expect(supportSql).toContain("public.support_ticket_messages");
  expect(supportSql).toContain("public.has_permission(auth.uid(),'support.manage')");
  expect(supportSql).not.toContain("grant insert on public.support_staff_notes to authenticated");
  expect(supportAction).toContain('hasPermission(session.user.id,"support.manage")');
 });
 it("support ticket mutation never moves funds and limits intake",()=>{
  expect(supportSql).toContain("ticket_rate_limited");
  expect(supportSql).toContain("interval '1 hour'");
  expect(supportSql).not.toContain("update public.seller_payouts");
  expect(supportAction).not.toContain("releaseSellerPayout");
  expect(supportAction).not.toContain("payoutInstruction");
 });
 it("listing reviewer is distinct from seller and has scoped permissions",()=>{
  expect(reviewSql).toContain("self_review_forbidden");
  expect(reviewSql).toContain("public.has_permission(v_uid,v_permission)");
  expect(reviewSql).toContain("for update");
  expect(reviewSql).toContain("r.status<>'PENDING'");
  expect(reviewSql).toContain("a.status<>'PENDING_REVIEW'");
  expect(reviewAction).toContain("hasPermission(user.id,permission)");
  expect(reviewAction).not.toContain("private.is_admin");
 });
 it("payment diagnostic reads provider but does not turn money on",()=>{
  expect(readiness).toContain("fetchLinkwaBalance");
  expect(readiness).toContain("HTTP 401");
  expect(readiness).not.toContain("instructLinkwaPayout");
  expect(readiness).not.toContain("payments_enabled:true");
 });
 it("preview deployments require a deliberate manual trigger",()=>{
  const workflow=read(".github/workflows/prebuilt-preview.yml");
  expect(workflow).toContain("workflow_dispatch");
  expect(workflow).not.toContain("on:\n  pull_request:");
 });
});
