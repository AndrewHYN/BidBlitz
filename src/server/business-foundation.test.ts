import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const business = readFileSync(
  join(process.cwd(), "supabase/migrations/20261007000009_business_sellers.sql"),
  "utf8"
);
const promotion = readFileSync(
  join(process.cwd(), "supabase/migrations/20261007000008_promotion_pricing.sql"),
  "utf8"
);

describe("basic business seller foundation", () => {
  it("keeps one business identity owned by one personal seller account", () => {
    expect(business).toContain("owner_id uuid not null unique");
    expect(business).toContain("a.seller_id <> v_uid");
    expect(business).toContain("b.owner_id=v_uid");
  });

  it("locks business identity once an auction leaves draft", () => {
    expect(business).toContain("if a.status <> 'DRAFT'");
    expect(business).toContain("identity_locked");
  });

  it("does not add verification, staff membership or catalog sync machinery", () => {
    expect(business.toLowerCase()).not.toContain("verified_business");
    expect(business.toLowerCase()).not.toContain("business_members");
    expect(business.toLowerCase()).not.toContain("catalog_sync");
  });

  it("allows only server-side logo writes while keeping public logo reads", () => {
    expect(business).toContain("business_logos_public_read");
    expect(business).toContain("No authenticated INSERT/UPDATE/DELETE policy");
  });
});

describe("simple promotion pricing", () => {
  it("quotes a fixed current price when the seller requests placement", () => {
    expect(promotion).toContain("quoted_price_minor");
    expect(promotion).toContain("promotion_settings");
    expect(promotion).toContain("where days=p_days and enabled=true");
  });

  it("keeps pricing admin-managed instead of creating an ad auction system", () => {
    expect(promotion).toContain("settings.manage_marketplace");
    expect(promotion.toLowerCase()).not.toContain("impression");
    expect(promotion.toLowerCase()).not.toContain("cpc");
    expect(promotion.toLowerCase()).not.toContain("ad_bid");
  });
});
