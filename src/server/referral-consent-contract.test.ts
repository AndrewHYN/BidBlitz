import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const referralSql = readFileSync(join(process.cwd(),
  "supabase/migrations/20261010082512_referral_attribution_no_rewards_20261010.sql"), "utf8");
const consentSql = readFileSync(join(process.cwd(),
  "supabase/migrations/20261010082515_marketing_consent_audit_20261010.sql"), "utf8");
const actions = readFileSync(join(process.cwd(), "src/server/actions/referrals.ts"), "utf8");
const publicPage = readFileSync(join(process.cwd(), "src/app/referrals/page.tsx"), "utf8");
const marketingPage = readFileSync(join(process.cwd(), "src/app/admin/marketing/page.tsx"), "utf8");

describe("community referral integrity", () => {
  it("associates a newcomer with only one immutable inviter and rejects self-referrals", () => {
    expect(referralSql).toContain("referred_user_id uuid primary key");
    expect(referralSql).toContain("check (referrer_user_id <> referred_user_id)");
    expect(referralSql).toContain("if v_inviter=v_uid then");
    expect(referralSql).toContain("already_redeemed");
  });
  it("does not reward old accounts or previous paid buyers", () => {
    expect(referralSql).toContain("p.created_at>clock_timestamp()-interval '30 days'");
    expect(referralSql).toContain("t.status in ('PAID','SETTLED')");
    expect(referralSql).toContain("prior_purchase_not_eligible");
  });
  it("does not leak invited identities or email addresses to staff", () => {
    expect(referralSql).toContain("alter table public.referral_signups enable row level security");
    expect(referralSql).toContain("revoke all on public.referral_codes,public.referral_signups");
    expect(referralSql).toContain("grant select on public.referral_codes to authenticated");
    expect(referralSql).not.toContain("grant select on public.referral_signups to authenticated");
    expect(referralSql).toContain("public.staff_referral_summary()");
    expect(marketingPage).toContain("Not sales, revenue, or paid conversions");
  });
  it("never automatically sends money or invents referral rewards", () => {
    expect(actions).not.toContain("releaseSellerPayout");
    expect(actions).not.toContain("instructLinkwaPayout");
    expect(referralSql).not.toContain("update public.seller_payouts");
    expect(publicPage).toContain("There are no cash rewards");
  });
  it("requires explicit new-user redemption instead of automatic attribution", () => {
    expect(actions).toContain("redeem_referral_code");
    expect(publicPage).toContain("InvitationControls");
    expect(publicPage).toContain("searchParams");
  });
});

describe("optional marketing consent", () => {
  it("stores real opt-in and opt-out transitions with an audit timestamp", () => {
    expect(consentSql).toContain("marketing_opt_in_at");
    expect(consentSql).toContain("marketing_opt_out_at");
    expect(consentSql).toContain("new.marketplace_activity is distinct from old.marketplace_activity");
  });
  it("does not expose customer email addresses to campaign operators", () => {
    expect(consentSql).toContain("public.staff_marketing_opt_in_summary()");
    expect(consentSql).toContain("public.has_permission(v_uid,'marketing.view')");
    expect(consentSql).toContain("p.email_verified=true");
    expect(consentSql).toContain("n.marketplace_activity=true and n.marketing_opt_in_at is not null");
    expect(consentSql).not.toContain("select email");
  });
});
