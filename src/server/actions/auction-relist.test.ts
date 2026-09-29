import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { duplicateAuctionAction } from "./auction";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * Relist contract: "List again" copies the seller's own UNSOLD auction into a
 * new DRAFT, and nothing else.
 *
 * What this file pins down is the authorization shape, because that is what a
 * unit test can prove exactly: the read filters to the caller, anything that
 * is not UNSOLD is refused before any write, every copied field passes through
 * the same schema the sell form uses, and images are never copied. The live
 * round trip (draft created, photos added, published) belongs to the browser,
 * where an UNSOLD fixture would take an hour to occur naturally.
 */

const USER_ID = "00000000-0000-0000-0000-000000000001";
const AUCTION_ID = "00000000-0000-0000-0000-000000000002";

const UNSOLD_ROW = {
  title: "Relistable radio",
  description: "A radio nobody bid on, described in plenty of detail.",
  category_id: 3,
  condition: "good",
  location: "Harare",
  currency: "USD",
  starting_bid_minor: 1000,
  bid_increment_minor: 100,
  duration_seconds: 3600,
  anti_snipe_window_seconds: 30,
  anti_snipe_extension_seconds: 30,
  status: "UNSOLD",
};

type QueryState = {
  table: string | null;
  payload: unknown;
  readFilters?: Array<{ column: string; value: unknown }>;
};

function mockSupabase(sourceRow: unknown, insertResult: { data?: unknown; error?: unknown }) {
  const state: QueryState = { table: null, payload: null };
  const readFilters: Array<{ column: string; value: unknown }> = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = () => builder;
  builder.eq = (column: unknown, value: unknown) => {
    readFilters.push({ column: String(column), value });
    return builder;
  };
  builder.maybeSingle = async () => ({ data: sourceRow, error: null });
  builder.insert = (payload: unknown) => {
    state.payload = payload;
    return builder;
  };
  builder.single = async () => insertResult;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => {
      state.table = table;
      return builder;
    },
  };
  vi.mocked(createClient).mockResolvedValue(client as never);
  // The live object, not a copy: the action runs after this returns.
  state.readFilters = readFilters;
  return state as QueryState & {
    readFilters: Array<{ column: string; value: unknown }>;
  };
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
});

describe("duplicateAuctionAction", () => {
  it("copies an UNSOLD auction into a new DRAFT with the same details", async () => {
    const state = mockSupabase(UNSOLD_ROW, { data: { id: AUCTION_ID }, error: null });

    const result = await duplicateAuctionAction({ auctionId: AUCTION_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.auctionId).toBe(AUCTION_ID);

    // The read was scoped to the caller's own row...
    expect(state.table).toBe("auctions");
    const sellerFilter = state.readFilters?.find((f) => f.column === "seller_id");
    expect(sellerFilter?.value).toBe(USER_ID);

    // ...and the write is a DRAFT carrying every field, with no images, no
    // bids, no winner, and none of the closed listing's state.
    const payload = state.payload as Record<string, unknown>;
    expect(payload.status).toBe("DRAFT");
    expect(payload.title).toBe(UNSOLD_ROW.title);
    expect(payload.description).toBe(UNSOLD_ROW.description);
    expect(payload.category_id).toBe(UNSOLD_ROW.category_id);
    expect(payload.starting_bid_minor).toBe(UNSOLD_ROW.starting_bid_minor);
    expect(payload.seller_id).toBe(USER_ID);
    expect(payload).not.toHaveProperty("winner_id");
    expect(payload).not.toHaveProperty("winning_bid_minor");
  });

  it("refuses anyone else's auction before any write", async () => {
    const state = mockSupabase(null, { data: null, error: null });

    const result = await duplicateAuctionAction({ auctionId: AUCTION_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("not_owner");
    // The select found nothing (RLS returns nobody else's row), so no insert ran.
    expect(state.payload).toBeNull();
  });

  for (const status of ["SOLD", "CANCELLED", "DRAFT", "LIVE", "SCHEDULED"]) {
    it(`refuses a ${status} auction: only UNSOLD may be listed again`, async () => {
      const state = mockSupabase({ ...UNSOLD_ROW, status }, { data: null, error: null });

      const result = await duplicateAuctionAction({ auctionId: AUCTION_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.code).toBe("invalid_state");
      expect(result.rejection.message).toMatch(/no bids/);
      expect(state.payload).toBeNull();
    });
  }

  it("re-validates copied fields through the sell schema instead of trusting the row", async () => {
    const state = mockSupabase(
      { ...UNSOLD_ROW, title: "x" },
      { data: null, error: null }
    );

    const result = await duplicateAuctionAction({ auctionId: AUCTION_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.title?.join(" ")).toMatch(/3 characters/);
    expect(state.payload).toBeNull();
  });
});
