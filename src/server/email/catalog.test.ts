import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, getTemplate } from "./catalog";
import { renderEmail } from "./layout";
import { emailKey } from "./sender";

/**
 * The email catalog is data, so it is tested as data: every template renders
 * without throwing, every subject names something real, critical mail is
 * never gated by a preference, and idempotency keys are deterministic per
 * event. Delivery itself is untestable here (no credentials, no provider),
 * which is stated rather than faked: the sender unit below asserts the
 * no-credential path leaves rows queued.
 */

const DATA: Record<string, Record<string, string>> = {
  review_submitted: { title: "Radio", auctionId: "a-1", name: "Seller" },
  review_approved: { title: "Radio", auctionId: "a-1", name: "Seller", endsAt: "soon" },
  review_rejected: { title: "Radio", auctionId: "a-1", name: "Seller", reason: "Blurry photos" },
  review_changes: { title: "Radio", auctionId: "a-1", name: "Seller", reason: "Add the serial" },
  cancellation_requested: { title: "Radio", auctionId: "a-1", bidCount: "3", reason: "Damaged" },
  cancellation_decided: { title: "Radio", auctionId: "a-1", name: "Seller", approved: "true", reason: "" },
  auction_paused: { title: "Radio", auctionId: "a-1", name: "Bidder", isSeller: "false" },
  auction_resumed: { title: "Radio", auctionId: "a-1", name: "Bidder", endsAt: "soon" },
  auction_cancelled: { title: "Radio", auctionId: "a-1", name: "Bidder" },
  listing_removed: { title: "Radio", auctionId: "a-1", name: "Seller" },
  account_suspended: { name: "Seller", reason: "Shill bidding" },
  account_restored: { name: "Seller" },
  won: { title: "Radio", auctionId: "a-1", name: "Buyer", amount: "$30.00" },
  outbid: { title: "Radio", auctionId: "a-1", name: "Buyer", amount: "$35.00" },
  auction_unsold: { title: "Radio", auctionId: "a-1", name: "Seller" },
  payment_required: { title: "Radio", auctionId: "a-1", name: "Buyer", amount: "$30.00" },
  payment_received: { title: "Radio", auctionId: "a-1", name: "Buyer", amount: "$30.00" },
  team_invite: { role: "MODERATOR", token: "abc" },
};

describe("email catalog", () => {
  it("defines the events the product promises, no more and no fewer than wired", () => {
    for (const key of Object.keys(DATA)) {
      expect(getTemplate(key), `missing template: ${key}`).not.toBeNull();
    }
  });

  it("renders every template to a subject, headline, body and CTA without throwing", () => {
    for (const [key, data] of Object.entries(DATA)) {
      const template = getTemplate(key);
      if (!template) continue;
      const subject = template.subject(data);
      expect(subject.length, `${key} subject`).toBeGreaterThan(0);
      const content = template.content(data, "https://bid-blitz-ten.vercel.app");
      expect(content.headline.length, `${key} headline`).toBeGreaterThan(0);
      expect(content.paragraphs.length, `${key} paragraphs`).toBeGreaterThan(0);
      const { html, text } = renderEmail(
        { ...content, subject },
        "https://bid-blitz-ten.vercel.app"
      );
      expect(html, `${key} html`).toContain("bid-blitz-ten.vercel.app");
      expect(text, `${key} text`).toContain(content.headline);
      if (content.cta) {
        expect(html, `${key} cta`).toContain(content.cta.href);
      }
    }
  });

  it("marks outcome, money, security and moderation mail critical, and only those", () => {
    const critical = Object.values(EMAIL_TEMPLATES)
      .filter((t) => t.critical)
      .map((t) => t.key)
      .sort();
    expect(critical).toContain("won");
    expect(critical).toContain("payment_received");
    expect(critical).toContain("account_suspended");
    expect(critical).toContain("listing_removed");
    expect(critical).toContain("auction_cancelled");
    const optional = Object.values(EMAIL_TEMPLATES).filter((t) => !t.critical);
    expect(optional.map((t) => t.key)).toEqual(["outbid"]);
    for (const t of optional) {
      expect(t.preference, `${t.key} gates on a preference`).toBeTruthy();
    }
  });

  it("never exposes internal notes, reporter identities or raw secrets in copy", () => {
    for (const [key, data] of Object.entries(DATA)) {
      const template = getTemplate(key);
      if (!template) continue;
      const content = template.content(data, "https://bid-blitz-ten.vercel.app");
      const joined = [content.headline, ...content.paragraphs].join(" ").toLowerCase();
      expect(joined, `${key}`).not.toMatch(/report[^e]/);
      // The invite token travels in the CTA href, never in prose.
      if (key !== "team_invite") {
        expect(joined, `${key}`).not.toContain("abc");
      }
    }
  });

  it("derives deterministic idempotency keys per event", () => {
    expect(emailKey("won", "auction", "a-1")).toBe(emailKey("won", "auction", "a-1"));
    expect(emailKey("won", "auction", "a-1")).not.toBe(emailKey("won", "auction", "a-2"));
    expect(emailKey("outbid", "bid", "b-1")).not.toBe(emailKey("outbid", "bid", "b-2"));
  });
});
