import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { createServerRealtime } from "@/lib/realtime/supabase";
import type { AuctionEvent } from "@/lib/realtime/types";

/**
 * Settlement sweep — closes every auction whose server clock has passed
 * `ends_at`, decides the winner, computes the fee and writes the transaction.
 *
 * DESIGN NOTE — this is one of THREE independent triggers, never the only one:
 *
 *   1. this route, on a schedule (see vercel.json)
 *   2. `settleIfDueAction()` when a viewer watches the countdown expire
 *   3. `place_bid()` itself, which settles an overdue auction before refusing
 *      the late bid
 *
 * (3) is inside Postgres and cannot be bypassed by a missing cron tick, so an
 * auction can never end in a state where the database disagrees with the wall
 * clock. The cron exists to make that state *visible* promptly for viewers who
 * are not currently looking at the auction.
 *
 * AUTH — Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`. We refuse
 * when CRON_SECRET is unset rather than accepting `Bearer undefined`, because a
 * secret that "defaults to empty" is not a secret.
 *
 * PRIVILEGE — this is the one place the secret key is legitimately used for a
 * background system job. It acts for no user: every row it touches is a public
 * auction status, and all writes happen inside SECURITY DEFINER functions that
 * re-derive the winner and the fee themselves.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ceiling for one run; the sweep itself takes `p_limit`. */
const SWEEP_LIMIT = 100;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

/** Length-independent-ish comparison; avoids leaking the secret via timing. */
function matches(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // unset => deny, never fall back to a default
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return matches(secret, header.slice(prefix.length));
}

export async function GET(request: Request): Promise<Response> {
  const started = Date.now();

  if (!isAuthorized(request)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!hasAdminCredentials()) {
    return json({ ok: false, error: "supabase_secret_key_not_configured" }, 503);
  }

  const admin = createAdminClient();

  // 0. Ending-soon notices. Independent of settlement (an auction can sit in
  //    its final window long before anything is due to close) and fully best
  //    effort: a notice failure must never be able to block settlement, so it
  //    is isolated in its own try/catch. The function itself dedupes to one
  //    notice per auction per recipient, so re-running is always safe.
  let endingSoon = 0;
  try {
    const soon = await admin.rpc("notify_ending_soon", { p_limit: SWEEP_LIMIT });
    if (soon.error) {
      console.error("[cron/settle] ending-soon failed", soon.error.message);
    } else {
      endingSoon = Number(soon.data ?? 0);
    }
  } catch (err) {
    console.error("[cron/settle] ending-soon threw", err);
  }

  // 1. Snapshot what is due BEFORE the sweep, so this run knows exactly which
  //    auctions it is responsible for announcing afterwards.
  const { data: due, error: dueError } = await admin
    .from("auctions")
    .select("id, status, ends_at")
    .eq("status", "LIVE")
    .lte("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: true })
    .limit(SWEEP_LIMIT);

  if (dueError) {
    console.error("[cron/settle] candidate query failed", dueError.message);
    return json({ ok: false, error: "candidate_query_failed" }, 502);
  }

  const candidates = due ?? [];
  if (candidates.length === 0) {
    return json({
      ok: true,
      scanned: 0,
      closed: 0,
      announced: 0,
      endingSoon,
      durationMs: Date.now() - started,
    });
  }

  // 2. Close them. Idempotent + `FOR UPDATE SKIP LOCKED`, so a concurrent
  //    worker settling the same row is safe and never double-writes.
  const { data: closed, error: sweepError } = await admin.rpc("settle_due_auctions", {
    p_limit: SWEEP_LIMIT,
  });
  if (sweepError) {
    console.error("[cron/settle] sweep failed", sweepError.message);
    return json({ ok: false, error: "sweep_failed" }, 502);
  }

  // 3. Re-read the snapshot. Only rows that actually left LIVE are announced —
  //    a row still LIVE means a concurrent worker holds its lock, and it will
  //    announce (or has already) on its own run.
  const ids = candidates.map((row) => row.id);
  const { data: after, error: afterError } = await admin
    .from("auctions")
    .select("id, status, winner_id, winning_bid_minor, seller_id")
    .in("id", ids);

  if (afterError) {
    console.error("[cron/settle] re-read failed", afterError.message);
    return json({ ok: false, error: "verification_failed" }, 502);
  }

  const settled = (after ?? []).filter((row) => row.status !== "LIVE");
  const sold = settled.filter((row) => row.status === "SOLD").length;

  // 4. Announce AFTER the commit. Best effort by design: a missed event never
  //    changes any state — the row is already durable and every page re-reads
  //    it from Postgres on the next request.
  let announced = 0;
  try {
    const rt = createServerRealtime(admin);
    const serverTime = new Date().toISOString();

    for (const row of settled) {
      if (row.status !== "SOLD" && row.status !== "UNSOLD") continue;
      const event: AuctionEvent = {
        type: "auction.ended",
        auctionId: row.id,
        status: row.status,
        winnerId: row.winner_id,
        winningBidMinor:
          row.winning_bid_minor === null || row.winning_bid_minor === undefined
            ? null
            : String(row.winning_bid_minor),
        serverTime,
      };
      await rt.publish(row.id, event);
      announced += 1;
    }
  } catch (err) {
    console.error("[cron/settle] realtime announce failed", err);
  }

  return json({
    ok: true,
    scanned: candidates.length,
    closed: Number(closed ?? 0),
    sold,
    unsold: settled.length - sold,
    announced,
    endingSoon,
    durationMs: Date.now() - started,
  });
}
