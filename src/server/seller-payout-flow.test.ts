import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261007000004_seller_payout_onboarding_and_release.sql"
  ),
  "utf8"
);
const checkout = readFileSync(
  join(process.cwd(), "src/app/api/payments/checkout/route.ts"),
  "utf8"
);
const release = readFileSync(
  join(process.cwd(), "src/server/payments/seller-payout.ts"),
  "utf8"
);

describe("seller payout release contract", () => {
  it("keeps new checkout behind the database runtime switch", () => {
    expect(checkout).toContain("paymentsRuntimeEnabled");
    expect(checkout).toContain('error: "payments_paused"');
  });

  it("requires a ready private payout wallet before publishing", () => {
    expect(migration).toContain("auction_require_payout_ready");
    expect(migration).toContain("payout_setup_required");
    expect(migration).toContain("setup_status = 'READY'");
    expect(migration).toContain("external_user_id is not null");
    expect(migration).toContain("external_wallet_id is not null");
  });

  it("lets only the buyer establish the normal handover confirmation", () => {
    expect(migration).toContain("buyer_confirm_delivery");
    expect(migration).toContain("if t.buyer_id <> v_uid");
    expect(migration).toContain("raise exception 'buyer_only'");
    expect(migration).toContain("t.status not in ('PAID','SETTLED')");
  });

  it("keeps the automatic money transition server-only", () => {
    expect(migration).toContain("service_transition_seller_payout");
    expect(migration).toMatch(
      /revoke all on function public\.service_transition_seller_payout\([\s\S]*?from public, anon, authenticated;/
    );
    expect(migration).toMatch(
      /grant execute on function public\.service_transition_seller_payout\([\s\S]*?to postgres, supabase_admin, service_role;/
    );
  });

  it("checks audit history and available Linkwa balance before payout", () => {
    expect(release).toContain("seller_payout_events");
    expect(release).toContain("fetchLinkwaBalance");
    expect(release).toContain("availableMinor < BigInt(payout.amount_minor)");
    expect(release).toContain('"PAYOUT_DUE"');
    expect(release).toContain('"PAID_OUT"');
  });

  it("does not promise direct EcoCash seller settlement", () => {
    expect(migration).toContain("wallet_provider in ('smilecash')");
    expect(migration).not.toContain("wallet_provider in ('ecocash'");
  });
});
