import "server-only";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { getTemplate } from "./catalog";
import { renderEmail } from "./layout";

/**
 * Email delivery: a durable outbox in Postgres, Resend on the wire.
 *
 * The rules, in order of how much damage breaking them does:
 *
 * 1. Marketplace state commits FIRST, email is enqueued AFTER, in the same
 *    server action but as a separate step. If enqueueing throws, the bid /
 *    settlement / decision stands: the catch below swallows it into a log
 *    line, because an email failure must never roll back a marketplace state.
 * 2. Idempotency keys make retries collapse: the same
 *    (template, entity, event) enqueued twice writes one row. `insert ... on
 *    conflict do nothing` is the enforcer, not application memory.
 * 3. Preferences gate OPTIONAL mail only. Critical mail always sends. The
 *    check reads the recipient's live row at dispatch time.
 * 4. Sending never throws into callers. Every failure is recorded on the row
 *    (attempts, last error) for the admin delivery view and the retry sweep.
 * 5. No credentials, no delivery claims: without RESEND_API_KEY the
 *    dispatcher leaves rows QUEUED and reports why. Nothing pretends an
 *    email went out.
 */

export type QueueEmailInput = {
  to: string;
  template: string;
  data?: Record<string, string>;
  /** Deterministic: same event re-queued must collapse to the stored row. */
  idempotencyKey: string;
};

export function emailKey(...parts: Array<string | number>): string {
  return parts.map((p) => String(p)).join(":");
}

function appUrl(): string {
  return (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    // Canonical production origin; `bid-blitz-ten.vercel.app` is the legacy
    // deployment and is never a fallback (see src/lib/site-url.ts).
    "https://bidblitz.co.zw"
  );
}

function emailFrom(): string {
  return process.env.EMAIL_FROM ?? "BidBlitz <noreply@bidblitz.test>";
}

/** Enqueue one email. Never throws: returns null when it cannot. */
export async function queueEmail(input: QueueEmailInput): Promise<string | null> {
  try {
    if (!getTemplate(input.template)) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) return null;
    if (!hasAdminCredentials()) return null;
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("email_outbox")
      .upsert(
        {
          idempotency_key: input.idempotencyKey,
          recipient: input.to.toLowerCase(),
          template_key: input.template,
          payload: input.data ?? {},
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      )
      .select("id")
      .single();
    if (error) {
      // The row never existed, so `last_error` cannot record this — and the
      // callers in notify.ts are best-effort by design. Without a log line a
      // critical mail (a win, a suspension, a cancellation) would vanish with
      // no trace at all, which is exactly what the header above promises will
      // not happen. Only the message: never the payload or any credential.
      console.warn("[email] enqueue failed:", error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (error) {
    console.warn(
      "[email] enqueue threw:",
      error instanceof Error ? error.message : "unknown error"
    );
    return null;
  }
}

type DispatchSummary = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  held: string | null;
};

/** Optional preference flags with safe defaults when no row exists. */
async function preferencesFor(
  admin: ReturnType<typeof createAdminClient>,
  userId: string | null
): Promise<{ outbid: boolean; ending_soon: boolean; marketplace_activity: boolean }> {
  const defaults = { outbid: true, ending_soon: true, marketplace_activity: false };
  if (!userId) return defaults;
  const { data } = await admin
    .from("notification_preferences")
    .select("outbid, ending_soon, marketplace_activity")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return defaults;
  const row = data as Record<string, unknown>;
  return {
    outbid: row.outbid !== false,
    ending_soon: row.ending_soon !== false,
    marketplace_activity: row.marketplace_activity === true,
  };
}

async function userIdForEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers();
  const match = (data?.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
  );
  return match?.id ?? null;
}

/**
 * Send due outbox rows. Bounded, idempotent, and incapable of throwing into
 * the caller: every path ends in a row update or a summary.
 */
export async function dispatchEmailOutbox(limit = 25): Promise<DispatchSummary> {
  const summary: DispatchSummary = { attempted: 0, sent: 0, skipped: 0, failed: 0, held: null };
  if (!hasAdminCredentials()) {
    summary.held = "no-service-credentials";
    return summary;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Nothing to send with, so nothing is attempted. Rows stay QUEUED for the
    // retry sweep; claiming them would only burn attempts for no reason.
    summary.held = "no-resend-credentials";
    return summary;
  }

  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc("claim_email_jobs", {
    p_limit: limit,
  });
  if (claimError || !claimed) return summary;

  const url = appUrl();
  const from = emailFrom();
  for (const job of claimed as Array<{
    id: string;
    recipient: string;
    template_key: string;
    payload: Record<string, string>;
    idempotency_key: string;
  }>) {
    summary.attempted += 1;
    try {
      const template = getTemplate(job.template_key);
      if (!template) {
        await admin
          .from("email_outbox")
          .update({ status: "FAILED", last_error: "unknown template" })
          .eq("id", job.id);
        summary.failed += 1;
        continue;
      }
      if (!template.critical && template.preference) {
        const uid = await userIdForEmail(admin, job.recipient);
        const prefs = await preferencesFor(admin, uid);
        if (prefs[template.preference] === false) {
          await admin
            .from("email_outbox")
            .update({ status: "SKIPPED", last_error: "disabled in preferences" })
            .eq("id", job.id);
          summary.skipped += 1;
          continue;
        }
      }
      const content = template.content(job.payload, url);
      const rendered = renderEmail(
        { ...content, subject: template.subject(job.payload) },
        url
      );
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": job.idempotency_key,
        },
        body: JSON.stringify({
          from,
          to: [job.recipient],
          subject: template.subject(job.payload),
          html: rendered.html,
          text: rendered.text,
        }),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        await admin
          .from("email_outbox")
          .update({
            status: "SENT",
            provider_message_id: body.id ?? null,
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", job.id);
        summary.sent += 1;
      } else if (res.status === 429 || res.status >= 500) {
        // Transient: back to the queue with the provider's complaint attached.
        const text = await res.text().catch(() => "");
        await admin
          .from("email_outbox")
          .update({ status: "QUEUED", last_error: `resend ${res.status}: ${text.slice(0, 200)}` })
          .eq("id", job.id);
        summary.failed += 1;
      } else {
        const text = await res.text().catch(() => "");
        await admin
          .from("email_outbox")
          .update({ status: "FAILED", last_error: `resend ${res.status}: ${text.slice(0, 200)}` })
          .eq("id", job.id);
        summary.failed += 1;
      }
    } catch (e) {
      await admin
        .from("email_outbox")
        .update({
          status: "QUEUED",
          last_error: e instanceof Error ? e.message.slice(0, 200) : "dispatch threw",
        })
        .eq("id", job.id)
        .then(
          () => undefined,
          () => undefined
        );
      summary.failed += 1;
    }
  }
  return summary;
}
