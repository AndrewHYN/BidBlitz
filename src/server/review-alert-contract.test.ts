import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const auctionAction = readFileSync(
  join(process.cwd(), "src/server/actions/auction.ts"),
  "utf8"
);
const reviewMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261007000002_staff_review_alerts_and_promotions.sql"
  ),
  "utf8"
);
const catalog = readFileSync(
  join(process.cwd(), "src/server/email/catalog.ts"),
  "utf8"
);

describe("listing review staff alert contract", () => {
  it("creates in-app alerts only for active staff with listing-review permission", () => {
    expect(reviewMigration).toContain("STAFF_REVIEW_REQUIRED");
    expect(reviewMigration).toContain("a.status = 'ACTIVE'");
    expect(reviewMigration).toContain("listings.review");
  });

  it("queues a staff email when publishing is held for review", () => {
    expect(auctionAction).toContain('payload.status === "PENDING_REVIEW"');
    expect(auctionAction).toContain('notifyAdmins(');
    expect(auctionAction).toContain('"staff_review_required"');
    expect(auctionAction).toContain('"listings.review"');
  });

  it("keeps the staff review email critical and deep-linked to the review queue", () => {
    expect(catalog).toContain('staff_review_required: {');
    expect(catalog).toContain('critical: true');
    expect(catalog).toContain('/admin#admin-review-heading');
  });
});

describe("immediate review email dispatch contract", () => {
  const notify = readFileSync(join(process.cwd(), "src/server/email/notify.ts"), "utf8");

  it("persists a review job before scheduling only its own dispatch", () => {
    const helper = notify.slice(notify.indexOf("async function queueNotification"), notify.indexOf("async function userContact"));
    expect(helper.indexOf("await queueEmail(input)")).toBeLessThan(helper.indexOf("after(async"));
    expect(helper).toContain("!jobId || !immediateReviewTemplates.has(input.template)");
    expect(helper).toContain("dispatchEmailOutbox(1, jobId)");
  });

  it("includes staff and seller review alerts in the immediate delivery policy", () => {
    const policy = notify.slice(notify.indexOf("const immediateReviewTemplates"), notify.indexOf("async function queueNotification"));
    for (const template of ["review_submitted", "staff_review_required", "review_approved", "review_rejected", "review_changes"]) {
      expect(policy).toContain(`"${template}"`);
    }
  });
});
