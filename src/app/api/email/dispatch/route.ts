import { dispatchEmailOutbox } from "@/server/email/sender";

/**
 * Retry sweep for queued email — and, today, the ONLY delivery path.
 *
 * The daily Hobby cron calls this route (`vercel.json`, 05:00). Nothing
 * dispatches inline: enqueueing happens in the actions that need mail, and
 * every row waits here until the next tick, so a "you won" notification can sit
 * for up to ~24h. That latency is a known, documented limitation (docs/EMAIL.md
 * and docs/POST_LAUNCH_BACKLOG.md), not a design goal — an inline dispatch in
 * the actions that can afford it is the deferred fix. This route never creates
 * mail, only delivers what the outbox holds.
 *
 * Auth mirrors /api/cron/settle: Vercel cron sends the shared secret, and an
 * unset secret denies rather than defaulting.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const summary = await dispatchEmailOutbox(100);
  return json({ ok: true, ...summary });
}
