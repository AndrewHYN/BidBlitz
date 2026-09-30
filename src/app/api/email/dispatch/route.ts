import { dispatchEmailOutbox } from "@/server/email/sender";

/**
 * Retry sweep for queued email. The daily Hobby cron calls this path; primary
 * delivery happens inline in the actions that enqueue (a viewer-triggered
 * settle, an admin decision), so this route only catches what a failed send
 * left behind. It never creates mail, only delivers what the outbox holds.
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
