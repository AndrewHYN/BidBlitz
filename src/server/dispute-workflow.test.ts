import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const disputes = readFileSync(
  join(process.cwd(), "supabase/migrations/20261007000006_transaction_disputes.sql"),
  "utf8"
);
const finance = readFileSync(
  join(process.cwd(), "supabase/migrations/20261007000007_admin_finance_snapshot.sql"),
  "utf8"
);
const actions = readFileSync(
  join(process.cwd(), "src/server/actions/disputes.ts"),
  "utf8"
);

describe("transaction dispute workflow", () => {
  it("freezes only safely unpaid seller payout states when a case opens", () => {
    expect(disputes).toContain("'WAITING_FOR_FULFILMENT','DELIVERY_CONFIRMED','PAYOUT_PENDING'");
    expect(disputes).toContain("set status='DISPUTED'");
    expect(disputes).not.toMatch(
      /p\.status in \([^)]*PAYOUT_DUE[^)]*\)[\s\S]{0,200}set status='DISPUTED'/
    );
  });

  it("refuses to pretend a provider-sensitive payout can be reversed", () => {
    expect(disputes).toContain("p.status in ('PAYOUT_DUE','PAID_OUT')");
    expect(disputes).toContain("payout_not_safely_reversible");
  });

  it("contains no refund transition or refund RPC in the dispute workflow", () => {
    expect(disputes.toLowerCase()).not.toContain("refund_transaction");
    expect(disputes.toLowerCase()).not.toContain("issue_refund");
    expect(disputes).not.toContain("'REFUND'");
    expect(actions.toLowerCase()).not.toContain("refund");
  });

  it("stores evidence in a private bucket and server action", () => {
    expect(disputes).toContain("'dispute-evidence'");
    expect(disputes).toContain("false,");
    expect(actions).toContain('createAdminClient()');
    expect(actions).toContain('.from("dispute-evidence")');
    expect(actions).toContain("validateAvatarBytes");
  });

  it("keeps public dispute RPCs invoker-only wrappers", () => {
    expect(disputes).toMatch(
      /create or replace function public\.open_transaction_dispute[\s\S]*?security invoker/
    );
    expect(disputes).toMatch(
      /create or replace function public\.add_transaction_dispute_message[\s\S]*?security invoker/
    );
    expect(disputes).toMatch(
      /create or replace function public\.staff_update_transaction_dispute[\s\S]*?security invoker/
    );
  });

  it("permission-gates the finance snapshot", () => {
    expect(finance).toContain("public.has_permission(v_uid,'payments.view')");
    expect(finance).toContain("public.has_permission(v_uid,'payouts.view')");
    expect(finance).toMatch(
      /create or replace function public\.admin_finance_snapshot\(\)[\s\S]*?security invoker/
    );
  });
});
