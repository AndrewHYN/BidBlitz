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
});
