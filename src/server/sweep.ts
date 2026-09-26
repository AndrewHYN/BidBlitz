import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";

/**
 * Opportunistic settlement sweep ("reconcile on read").
 *
 * Postgres closes an auction the moment anything asks about it — `place_bid()`
 * settles an overdue auction before refusing the late bid, and the auction
 * detail page calls `settleIfDueAction()` when the countdown expires. Those two
 * are precise but event-driven: an auction nobody is watching could otherwise
 * sit in LIVE past `ends_at` until the next scheduled sweep, and a browse card
 * would then show a "Live" badge next to a countdown reading 00:00:00.
 *
 * So public read paths also nudge the sweep. It is deliberately:
 *
 *   - THROTTLED — at most one call per instance per minute, so browsing costs
 *     no extra query in the common case;
 *   - NON-FATAL — a missing secret key or a failed RPC degrades to a stale
 *     badge, never to a broken page;
 *   - NON-AUTHORITATIVE — this performs no auction logic itself. It only
 *     invokes `settle_due_auctions()`, which re-derives every winner and fee
 *     inside SECURITY DEFINER code with `FOR UPDATE SKIP LOCKED`.
 *
 * It is the third of three independent triggers (page view / bid / cron + read
 * path), which is why no single missed trigger can leave the tables lying.
 */

/** Minimum gap between sweep attempts from THIS instance. */
const SWEEP_INTERVAL_MS = 60_000;

/** Ceiling per attempt; the function pages itself if more are due. */
const SWEEP_LIMIT = 50;

let lastAttemptAt = 0;

export type SweepResult = {
  ran: boolean;
  settled: number;
  error: string | null;
};

const SKIPPED: SweepResult = { ran: false, settled: 0, error: null };

/**
 * Settle any auction whose server clock has passed `ends_at`.
 * Never throws: a sweep failure must not be able to fail a page render.
 */
export async function sweepDueAuctions(
  opts: { force?: boolean } = {}
): Promise<SweepResult> {
  const now = Date.now();

  if (!opts.force && now - lastAttemptAt < SWEEP_INTERVAL_MS) return SKIPPED;
  lastAttemptAt = now;

  // Never write to the database while `next build` is prerendering.
  if (process.env.NEXT_PHASE === "phase-production-build") return SKIPPED;

  if (!hasAdminCredentials()) {
    // Honest degradation: report it once, keep rendering from what we have.
    return { ran: false, settled: 0, error: "supabase_secret_key_not_configured" };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("settle_due_auctions", {
      p_limit: SWEEP_LIMIT,
    });
    if (error) {
      console.error("[sweep] settle_due_auctions failed:", error.message);
      return { ran: true, settled: 0, error: error.message };
    }

    // Ending-soon notices ride the same throttle and the same contract as
    // settlement: best effort, logged, never able to fail a page render.
    // Once per auction per recipient (the function dedupes), so the extra
    // call costs a single indexed RPC per sweep, not a notification storm.
    try {
      const soon = await admin.rpc("notify_ending_soon", {
        p_limit: SWEEP_LIMIT,
      });
      if (soon.error) {
        console.error("[sweep] notify_ending_soon failed:", soon.error.message);
      }
    } catch (err) {
      console.error(
        "[sweep] notify_ending_soon threw:",
        err instanceof Error ? err.message : String(err)
      );
    }

    return { ran: true, settled: Number(data ?? 0), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sweep] failed:", message);
    return { ran: true, settled: 0, error: message };
  }
}

/** Test hook: forget when the last attempt happened. */
export function resetSweepThrottle(): void {
  lastAttemptAt = 0;
}
