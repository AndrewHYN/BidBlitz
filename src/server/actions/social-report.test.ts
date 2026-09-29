import { describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { reportAction } from "./social";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

/**
 * Report intake contract: what a reporter is told, and why.
 *
 * A report is a moderation signal from an ordinary user, so every refusal has
 * to name the actual situation. The two refusals that matter most are the ones
 * that look like failures but are not: filing twice (the first report is
 * already queued) and filing against something that no longer exists (there
 * is nothing to review). Both are asserted here against the action, with the
 * database behind a mock, because the shape of the answer is decided here -
 * the database only supplies the constraint violation or the empty row.
 */

const USER_ID = "12345678-1234-4123-8123-123456789012";
const TARGET_ID = "12345678-1234-4123-8123-123456789013";

function mockClient(targetRow: unknown, insertError: unknown) {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const maybeBuilder = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: targetRow, error: null }),
      }),
    }),
    insert: (payload: unknown) => {
      calls.push({ table: "reports", op: "insert", payload });
      return Promise.resolve({ data: null, error: insertError });
    },
  });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => maybeBuilder(),
  } as never);
  return calls;
}

describe("reportAction", () => {
  it("accepts a report against an existing auction", async () => {
    const calls = mockClient({ id: TARGET_ID }, null);
    const result = await reportAction({
      targetType: "auction",
      targetId: TARGET_ID,
      reason: "Counterfeit serial number on this listing",
    });
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("tells a repeat reporter their first report stands, instead of an error", async () => {
    mockClient({ id: TARGET_ID }, { message: 'duplicate key value violates unique constraint "reports_reporter_', code: "23505" });
    const result = await reportAction({
      targetType: "auction",
      targetId: TARGET_ID,
      reason: "Reporting again with more detail",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("duplicate_report");
    expect(result.rejection.message).toMatch(/already reported/i);
    expect(result.rejection.message).not.toMatch(/went wrong/i);
  });

  it("refuses a report against a listing that no longer exists", async () => {
    mockClient(null, null);
    const result = await reportAction({
      targetType: "auction",
      targetId: TARGET_ID,
      reason: "This listing looked fraudulent",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.message).toMatch(/no longer available/i);
  });

  it("refuses a report against your own account", async () => {
    mockClient({ id: USER_ID }, null);
    const result = await reportAction({
      targetType: "user",
      targetId: USER_ID,
      reason: "Reporting myself for some reason",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.message).toMatch(/your own account/i);
  });
});
