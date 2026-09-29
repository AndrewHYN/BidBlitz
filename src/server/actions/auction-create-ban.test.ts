import { describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createAuctionAction } from "./auction";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * A suspended account is refused at the door of listing creation, not after
 * filling the form: the is_banned triggers would refuse the publish anyway,
 * but "created, now it can't be published" strands a draft and answers the
 * wrong question. The honest answer names the suspension and where to appeal.
 */

const DRAFT_INPUT = {
  title: "A suspended seller lists a radio",
  description: "Described in plenty of detail, as the schema requires.",
  categoryId: 3,
  condition: "good",
  location: "Harare",
  startingBidMinor: "1000",
  bidIncrementMinor: "100",
  durationSeconds: 3600,
  antiSnipeWindowSeconds: 30,
  antiSnipeExtensionSeconds: 30,
  currency: "USD",
};

function mockClient(banned: boolean) {
  let inserted = false;
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => ({ data: { is_banned: banned }, error: null });
  builder.insert = () => {
    inserted = true;
    return builder;
  };
  builder.single = async () => ({ data: { id: "new-id" }, error: null });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: () => builder,
  } as never);
  return () => inserted;
}

describe("createAuctionAction banned door", () => {
  it("refuses a suspended seller before any draft is written", async () => {
    const wasInserted = mockClient(true);
    const result = await createAuctionAction(DRAFT_INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("account_banned");
    expect(result.rejection.message).toMatch(/can't bid or list/i);
    expect(wasInserted()).toBe(false);
  });

  it("lets an ordinary seller through to the normal flow", async () => {
    const wasInserted = mockClient(false);
    const result = await createAuctionAction(DRAFT_INPUT);
    expect(result.ok).toBe(true);
    expect(wasInserted()).toBe(true);
  });
});
