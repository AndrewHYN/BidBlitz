import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { dispatchEmailOutbox } from "@/server/email/sender";

/**
 * Retry sweep for queued email.
 *
 * The daily Hobby cron calls this route (`vercel.json`, 05:00 UTC).
 * Direct listing chat alerts can now deliver inline for timely notification;
 * other queued emails still wait for this sweep. It also queues daily opted-in
 * marketplace recommendations before dispatch.
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
  let marketplaceQueued = 0;
  let marketplaceError = false;
  if (hasAdminCredentials()) {
    try {
      const { data, error } = await createAdminClient().rpc("queue_marketplace_daily_match");
      marketplaceError = Boolean(error);
      if (!error) marketplaceQueued = Number(data ?? 0);
    } catch {
      marketplaceError = true;
    }
  }
  const summary = await dispatchEmailOutbox(100);
  return json({ ok: !marketplaceError && !summary.held, marketplaceQueued, marketplaceError, ...summary });
}
