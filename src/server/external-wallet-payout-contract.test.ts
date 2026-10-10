import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(),
  "supabase/migrations/20261010120000_manual_seller_wallet_settlement.sql"), "utf8");
const actions = readFileSync(join(process.cwd(),"src/server/actions/external-payouts.ts"),"utf8");
const payout = readFileSync(join(process.cwd(),"src/server/payments/seller-payout.ts"),"utf8");
const cron = readFileSync(join(process.cwd(),"src/app/api/cron/settle/route.ts"),"utf8");
const runtime = readFileSync(join(process.cwd(),"src/server/payments/runtime.ts"),"utf8");
const desk = readFileSync(join(process.cwd(),"src/app/admin/finance/payouts/page.tsx"),"utf8");

describe("seller wallet settlement release safeguards", () => {
  it("preserves the separate buyer checkout switch and keeps automatic seller payouts OFF by default", () => {
    expect(sql).toContain("automatic_payouts_enabled boolean not null default false");
    expect(runtime).toContain('data?.automatic_payouts_enabled === true');
    expect(runtime).toContain('data?.payments_enabled === true');
    expect(cron).toContain("automaticSellerPayoutsEnabled()");
    expect(cron).toContain("sellerPayoutsInstructed: 0");
  });

  it("will not send Linkwa payout funds when the same sale is reserved for EcoCash", () => {
    expect(sql).toContain("external_payout_already_reserved");
    expect(sql).toContain("zz_external_claim_blocks_linkwa");
    expect(payout).toContain('"external_seller_payout_claims"');
    expect(payout).toContain('externalClaim?.status === "RESERVED"');
    expect(desk).toContain("externalClaim === null");
  });

  it("freezes the exact seller amount, currency, owner and wallet destination at reservation", () => {
    expect(sql).toContain("payout_id uuid primary key references public.seller_payouts");
    expect(sql).toContain("destination_phone_e164 text not null");
    expect(sql).toContain("v_tx.net_minor is distinct from v_payout.amount_minor");
    expect(sql).toContain("v_payout.amount_minor<>v_claim.amount_minor");
    expect(sql).toContain("v_payout.seller_id<>v_claim.seller_id");
    expect(sql).toContain("v_payout.payout_reference is not null");
  });

  it("enforces an independently verified seller receipt and a unique transfer reference", () => {
    expect(sql).toContain("p_seller_receipt_verified is distinct from true");
    expect(sql).toContain("receipt_reference text unique");
    expect(sql).toContain("receipt_reference=new.payout_reference");
    expect(sql).toContain("ext.status='RECEIPT_CONFIRMED'");
    expect(sql).toContain("v_claim.status<>'RESERVED'");
    expect(sql).toContain("public.staff_confirm_external_seller_payout");
    expect(actions).toContain("sellerReceiptVerified: z.literal(true)");
    expect(actions).toContain('requirePermission("payouts.mark_paid")');
  });

  it("never tries to pay an ambiguous prior Linkwa payout again", () => {
    expect(sql).toContain("historical_provider_attempt_exists");
    expect(sql).toContain("provider_payout_attempt_exists");
    expect(sql).toContain("payout_reference is not null");
    expect(sql).toContain("e.to_status in ('PAYOUT_DUE','PAID_OUT')");
  });

  it("requires explicit confirmation that no money was sent to cancel a claim", () => {
    expect(sql).toContain("p_no_transfer_sent is distinct from true");
    expect(actions).toContain("noTransferSent: z.literal(true)");
    expect(sql).toContain("status='CANCELLED'");
    expect(sql).toContain("status='RECEIPT_CONFIRMED'");
  });

  it("blocks direct client writes and retains append-only staff events", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.external_seller_payout_claims");
    expect(sql).toContain("grant select on public.external_seller_payout_claims");
    expect(sql).not.toContain("grant insert on public.external_seller_payout_claims");
    expect(sql).toContain("public.external_seller_payout_events");
    expect(actions).not.toContain("instructLinkwaPayout");
    expect(actions).not.toContain("fetchLinkwaBalance");
  });
});
