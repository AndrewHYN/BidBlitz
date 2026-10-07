import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const release = readFileSync(
  join(process.cwd(), "src/server/payments/seller-payout.ts"),
  "utf8"
);
const adminAction = readFileSync(
  join(process.cwd(), "src/server/actions/linkwa-payouts.ts"),
  "utf8"
);
const cron = readFileSync(
  join(process.cwd(), "src/app/api/cron/settle/route.ts"),
  "utf8"
);

describe("seller payout release safety", () => {
  it("checks Linkwa available USD balance before the network payout instruction", () => {
    const balance = release.indexOf("fetchLinkwaBalance");
    const claim = release.indexOf('"PAYOUT_DUE"');
    const instruct = release.indexOf("instructLinkwaPayout(");

    expect(balance).toBeGreaterThan(-1);
    expect(release).toContain("availableMinor < BigInt(payout.amount_minor)");
    expect(balance).toBeLessThan(claim);
    expect(claim).toBeLessThan(instruct);
  });

  it("does not automatically retry an ambiguous PAYOUT_DUE provider instruction", () => {
    expect(release).toContain('if (payout.status === "PAYOUT_DUE")');
    expect(release).toContain('"manual_reconciliation_required"');
    expect(release).toContain("Do not send another");
  });

  it("keeps the admin fallback on the same payout engine", () => {
    expect(adminAction).toContain('import { releaseSellerPayout }');
    expect(adminAction).toContain("await releaseSellerPayout(parsed.data.payoutId)");
    expect(adminAction).not.toContain("instructLinkwaPayout");
  });

  it("retries safe pending payouts independently of auction closure", () => {
    expect(cron).toContain("retryReadySellerPayouts");
    expect(cron).toContain('"DELIVERY_CONFIRMED", "PAYOUT_PENDING"');
    expect(cron).toContain("sellerPayoutsReleased");
  });
});
