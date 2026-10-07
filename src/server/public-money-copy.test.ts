import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC_MONEY_PAGES = [
  "src/app/about/page.tsx",
  "src/app/how-it-works/page.tsx",
  "src/app/faq/page.tsx",
  "src/app/help/page.tsx",
  "src/app/help/fees/page.tsx",
  "src/app/terms/page.tsx",
];

const text = PUBLIC_MONEY_PAGES.map((path) =>
  readFileSync(join(process.cwd(), path), "utf8")
).join("\n");
const privacy = readFileSync(
  join(process.cwd(), "src/app/privacy/page.tsx"),
  "utf8"
);
const terms = readFileSync(
  join(process.cwd(), "src/app/terms/page.tsx"),
  "utf8"
);

describe("public money copy", () => {
  it("does not describe the retired manual-operator payout model", () => {
    for (const stale of [
      "pay sellers automatically",
      "administrator-run step",
      "operator runs after the sale",
      "BidBlitz never sends a payout on its own",
      "dispute window has passed",
      "window to raise a dispute has passed",
    ]) {
      expect(text.toLowerCase()).not.toContain(stale.toLowerCase());
    }
  });

  it("does not promise an automatic BidBlitz refund", () => {
    expect(text).not.toContain("can lead to a refund to the buyer");
    expect(text).not.toContain("A refund to the buyer also holds the payout");
  });

  it("states the actual payout trigger and dispute boundary", () => {
    expect(text).toContain("buyer confirms handover");
    expect(text).toContain("5% platform fee");
    expect(text).toContain("unresolved dispute");
    expect(text).toContain("does not issue an automatic refund");
  });

  it("keeps privacy aligned with payout and dispute data", () => {
    expect(privacy).toContain("Seller payout data");
    expect(privacy).toContain("Dispute data");
    expect(privacy).toContain("Resend");
    expect(privacy).toContain("Linkwa");
    expect(privacy).toContain("payout phone");
  });

  it("does not turn business or promotion labels into trust or auction advantage claims", () => {
    expect(terms).toContain("Business seller");
    expect(terms).toContain("not a claim that BidBlitz has verified");
    expect(terms).toContain("Promoted listings are clearly labelled");
    expect(terms).toContain("never changes bid order");
  });

  it("keeps document navigation anchors in sync for the renamed Terms sections", () => {
    expect(terms).toContain('{ id: "account", title: "2. Your account" }');
    expect(terms).toContain('<TermsSection id="account" title="2. Your account">');
    expect(terms).toContain('{ id: "ownership", title: "11. What you list is yours" }');
    expect(terms).toContain('<TermsSection id="ownership" title="11. What you list is yours">');
    expect(terms).toContain('{ id: "provision", title: "12. How the site is provided" }');
    expect(terms).toContain('<TermsSection id="provision" title="12. How the site is provided">');
  });
});
