import { describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getSelling } from "./queries";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

/**
 * PostgREST shapes an embedded resource by the relationship's cardinality,
 * not by what the query asks for. `transactions.auction_id` is UNIQUE, so one
 * auction has at most one transaction and the embed arrives as an OBJECT or
 * NULL - never the array the old code assumed.
 *
 * That assumption crashed /dashboard/selling for every seller with listings:
 * `item.transactions[0]` throws on null, and silently hides the sale summary
 * on an object (object[0] is undefined). No e2e ever visited the page with
 * rows, which is how a crash-on-every-listing survived every gate. The query
 * layer normalizes to an array once, so the declared type is the runtime
 * truth; these tests pin that normalization on all three shapes.
 */

function mockAuctions(rows: unknown[]) {
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = async () => ({ data: rows, error: null });
  vi.mocked(createClient).mockResolvedValue({
    from: () => builder,
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
  } as never);
}

const BASE_ROW = {
  id: "a-1",
  title: "Test radio",
  current_bid_minor: null,
  starting_bid_minor: 1000,
  bid_count: 0,
  ends_at: null,
  status: "LIVE",
  location: "Harare",
  condition: "good",
  featured: false,
  categories: null,
  auction_images: [],
  winner_id: null,
  winning_bid_minor: null,
  seller_id: "u-1",
  created_at: "2026-09-29T00:00:00Z",
};

const TX = {
  id: "t-1",
  status: "AWAITING_PAYMENT",
  gross_minor: 1000,
  fee_minor: 50,
  net_minor: 950,
  currency: "USD",
};

describe("getSelling transaction normalization", () => {
  // Distinct ids per case: getSelling is wrapped in React cache(), which
  // memoizes by argument, so sharing one id could let cases read each other's
  // rows instead of their own fixture.
  it("turns a null embed into an empty array instead of crashing the page", async () => {
    mockAuctions([{ ...BASE_ROW, transactions: null }]);
    const [item] = await getSelling("u-null");
    expect(item.transactions).toEqual([]);
    // The exact expression that threw: null[0] crashes, [][0] is undefined.
    expect(item.transactions[0] ?? null).toBeNull();
  });

  it("wraps a to-one object into a one-element array so the sale shows", async () => {
    mockAuctions([{ ...BASE_ROW, status: "SOLD", transactions: { ...TX } }]);
    const [item] = await getSelling("u-obj");
    expect(item.transactions).toEqual([{ ...TX }]);
    expect(item.transactions[0]?.id).toBe("t-1");
  });

  it("passes a real array through untouched", async () => {
    mockAuctions([{ ...BASE_ROW, transactions: [{ ...TX }] }]);
    const [item] = await getSelling("u-arr");
    expect(item.transactions).toEqual([{ ...TX }]);
  });
});
