import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NotificationsList, type NotificationItem } from "./notifications-list";

vi.mock("./notification-link", () => ({
  NotificationLink: ({ href, children }: { href: string; children: ReactNode }) => h("a", { href }, children),
}));

function row(fields: Partial<NotificationItem>) {
  const item: NotificationItem = { id: "n1", auction_id: "listing-1", listingKind: "SALE", photo: null,
    type: "AUCTION_PUBLISHED", payload: { title: "New Zealand Rabbits", ends_at: "2026-12-01T12:00:00Z" },
    read_at: null, created_at: "2026-11-20T12:51:00Z", ...fields };
  return renderToStaticMarkup(h(NotificationsList, { items: [item] }));
}

describe("marketplace notifications", () => {
  it("renders stored legacy publication events with the actual listing type", () => {
    const sale = row({});
    expect(sale).toContain("is now for sale");
    expect(sale).toContain('href="/listing/listing-1"');
    expect(sale).not.toMatch(/auction|bidding/i);
    expect(row({ listingKind: "SERVICE" })).toContain("available to hire");
    expect(row({ listingKind: "AUCTION" })).toContain("Bidding closes");
    expect(row({ listingKind: null })).not.toMatch(/auction|bidding/i);
  });
  it("opens the conversation from the entire message notification", () => {
    const message = row({ type: "NEW_MESSAGE", payload: { listingChatId: "thread-1" } });
    expect(message).toContain('href="/messages/thread-1"');
    expect(message).not.toContain("Reply");
    expect(row({ type: "NEW_MESSAGE", payload: { transactionId: "tx" } })).toContain('/dashboard/transactions/tx#messages');
  });
  it("distinguishes pickup and sold updates without claiming a completed purchase", () => {
    const pickup = row({ type: "NEW_MESSAGE", payload: { listingChatId: "thread-1", title: "Laptop", event: "pickup_pending" } });
    expect(pickup).toContain("Pickup being arranged");
    expect(pickup).toContain('href="/messages/thread-1"');
    expect(pickup).not.toContain("New message about");
    const cancelled = row({ type: "NEW_MESSAGE", payload: { listingChatId: "thread-1", title: "Laptop", event: "pickup_cancelled" } });
    expect(cancelled).toContain("Pickup arrangement cancelled");
    const sold = row({ type: "NEW_MESSAGE", payload: { listingChatId: "thread-1", title: "Laptop", event: "listing_sold" } });
    expect(sold).toContain("has been marked sold");
    expect(sold).toContain("does not mean you purchased");
  });
  it("distinguishes staff moderation, seller decisions and trader feedback", () => {
    expect(row({ type: "STAFF_REVIEW_REQUIRED", payload: { review_id: "r1" } })).toContain('/admin/listings#review-r1');
    expect(row({ type: "REVIEW_APPROVED" })).toContain('href="/listing/listing-1"');
    expect(row({ type: "REVIEW_REQUEST", payload: { transaction_id: "tx" } })).toContain('/dashboard/transactions#review-tx');
  });
  it("exposes read status in text as well as style", () => {
    expect(row({})).toContain('Unread</span>');
    expect(row({ read_at: "2026-11-20T14:00:00Z" })).toContain('Read</span>');
  });
});
