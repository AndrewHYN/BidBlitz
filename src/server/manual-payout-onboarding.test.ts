import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const sql = source("supabase/migrations/20261010141000_manual_payout_contact_onboarding.sql");
const action = source("src/server/actions/payout-setup.ts");
const sell = source("src/app/sell/page.tsx");
const settings = source("src/components/auth/payout-settings-form.tsx");
const payoutEngine = source("src/server/payments/seller-payout.ts");

describe("manual seller wallet contact onboarding", () => {
  it("checks authenticated owner and normalized Zimbabwe contact in DB", () => {
    expect(sql).toContain("v_uid uuid := auth.uid()");
    expect(sql).toContain("if v_uid is null");
    expect(sql).toContain("v_phone !~ '^[+]263[0-9]{9}$'");
    expect(sql).toContain("values (v_uid,'linkwa'");
    expect(sql).not.toContain("p_seller_id");
    expect(sql).toContain("revoke all on function public.set_manual_payout_contact");
    expect(sql).toContain("to authenticated");
  });

  it("allows publishing with verified contact format, not invented Linkwa provider IDs", () => {
    expect(sql).toContain("r.setup_status='MANUAL_READY'");
    expect(sql).toContain("r.setup_status='READY'");
    expect(sql).toContain("r.external_user_id is not null");
    expect(sql).toContain("r.phone_e164 ~ '^[+]263[0-9]{9}$'");
    expect(sql).toContain("private.auction_require_payout_ready");
    expect(sell).toContain('wallet?.setup_status === "MANUAL_READY"');
    expect(settings).toContain('mode === "MANUAL"');
  });

  it("never changes frozen payouts or calls provider during manual setup", () => {
    expect(sql).toContain("external_user_id=null,external_wallet_id=null,wallet_provider=null");
    expect(sql).not.toContain("update public.seller_payouts");
    expect(sql).not.toContain("insert into public.external_seller_payout_claims");
    expect(action).toContain('supabase.rpc("set_manual_payout_contact"');
    expect(payoutEngine).toContain('recipient.setup_status !== "READY"');
  });

  it("does not present a saved phone number as evidence that money moved", () => {
    expect(settings).toContain("No money has moved");
    expect(settings).toContain("This does not mean a transfer has been sent or received");
    expect(sell).toContain("Finance checks the recipient");
  });
});
