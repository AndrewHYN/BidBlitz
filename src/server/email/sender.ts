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

type Job = {
  id: string; recipient: string; template_key: string;
  payload: Record<string, string>; idempotency_key: string;
  attempts: number; delivery_uncertain: boolean;
};

export function retryDelayMs(attempt: number, retryAfter: string | null = null): number {
  const backoff = Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
  return Math.max(backoff, Math.min(seconds, 24 * 60 * 60_000));
}

async function preferencesFor(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin.from("notification_preferences")
    .select("outbid, ending_soon, listing_message_alerts").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("preference lookup unavailable");
  return {
    outbid: data?.outbid !== false,
    ending_soon: data?.ending_soon !== false,
    listing_message_alerts: data?.listing_message_alerts !== false,
  };
}

/** Atomic one-job claims keep a timeout from stranding an entire batch. */
export async function dispatchEmailOutbox(limit = 25, specificJobId?: string): Promise<DispatchSummary> {
  const summary: DispatchSummary = { attempted: 0, sent: 0, skipped: 0, failed: 0, held: null };
  if (!hasAdminCredentials()) { summary.held = "no-service-credentials"; return summary; }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { summary.held = "no-resend-credentials"; return summary; }
  const from = process.env.EMAIL_FROM;
  if (!from || from.includes("@bidblitz.test")) { summary.held = "no-valid-sender"; return summary; }
  const admin = createAdminClient();
  const deadline = Date.now() + 42_000;
  const max = specificJobId ? 1 : Math.min(100, Math.max(1, limit));
  try {
    for (let i = 0; i < max && Date.now() < deadline; i++) {
      const { data, error } = await admin.rpc("claim_email_jobs_v2", { p_limit: 1, p_job_id: specificJobId ?? null });
      if (error) { summary.held = "claim-failed"; break; }
      const job = (data as Job[] | null)?.[0];
      if (!job) break;
      summary.attempted++;
      const update = async (values: Record<string, unknown>) => {
        const result = await admin.from("email_outbox").update(values).eq("id", job.id)
          .eq("status", "SENDING").eq("attempts", job.attempts).select("id");
        if (result.error || !result.data?.length) throw new Error("outbox update failed");
      };
      const retry = async (reason: string, uncertain: boolean, after: string | null = null) => {
        const exhausted = job.attempts >= 6;
        await update({ status: exhausted ? "FAILED" : "QUEUED",
          next_attempt_at: new Date(Date.now() + retryDelayMs(job.attempts, after)).toISOString(),
          delivery_uncertain: job.delivery_uncertain || uncertain,
          last_error: exhausted ? "retry limit reached: " + reason : reason });
      };
      let providerAttempted = false;
      try {
        const template = getTemplate(job.template_key);
        if (!template) { await update({ status: "FAILED", last_error: "unknown template" }); summary.failed++; continue; }
        if (!template.critical && template.preference) {
          // Resolve the CURRENT verified recipient, even for old rows. Do not
          // send optional mail if we cannot establish whose preferences apply.
          const { data: uid, error: lookupError } = await admin.rpc("email_recipient_id", { p_email: job.recipient });
          if (lookupError) throw new Error("recipient lookup unavailable");
          if (typeof uid !== "string" || (job.payload.recipientId && job.payload.recipientId !== uid)) {
            await update({ status: "SKIPPED", last_error: "recipient no longer verified" }); summary.skipped++; continue;
          }
          const prefs = await preferencesFor(admin, uid);
          if (!prefs[template.preference]) {
            await update({ status: "SKIPPED", last_error: "disabled in preferences" }); summary.skipped++; continue;
          }
          if (job.template_key === "listing_message" && job.payload.conversationId) {
            const { data: chat, error: chatError } = await admin.from("listing_chat_preferences")
              .select("muted").eq("user_id", uid).eq("conversation_id", job.payload.conversationId).maybeSingle();
            if (chatError) throw new Error("chat preference lookup unavailable");
            if (chat?.muted) { await update({ status: "SKIPPED", last_error: "chat muted" }); summary.skipped++; continue; }
          }
        }
        const url = appUrl();
        const rendered = renderEmail({ ...template.content(job.payload, url), subject: template.subject(job.payload) }, url);
        providerAttempted = true;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST", signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": job.idempotency_key },
          body: JSON.stringify({ from, to: [job.recipient], subject: template.subject(job.payload), html: rendered.html, text: rendered.text }),
        });
        if (res.ok) {
          const body = (await res.json()) as { id?: string };
          if (!body.id) throw new Error("provider accepted without ID");
          await update({ status: "SENT", provider_message_id: body.id, sent_at: new Date().toISOString(), last_error: null, delivery_uncertain: false });
          summary.sent++;
        } else if (res.status === 429 || res.status >= 500 || res.status === 408) {
          await retry(`resend ${res.status}`, res.status !== 429, res.headers?.get("retry-after") ?? null);
          summary.failed++;
          if (res.status === 429) { summary.held = "provider-rate-limit"; break; }
        } else {
          // Never store raw provider error bodies: they may contain PII.
          const body = await res.json().catch(() => null) as { name?: string } | null;
          if (res.status === 409 && body?.name === "concurrent_idempotent_requests") {
            await retry("resend 409: concurrent request", true); summary.failed++;
          } else {
            await update({ status: "FAILED", last_error: `resend ${res.status}` }); summary.failed++;
            if (res.status === 401 || res.status === 403) { summary.held = "provider-configuration"; break; }
          }
        }
      } catch {
        try { await retry(providerAttempted ? "delivery uncertain: provider or write failure" : "temporary pre-send failure", providerAttempted); }
        catch { summary.held = "outbox-write-failed"; }
        summary.failed++;
        if (summary.held) break;
      }
    }
  } catch { summary.held = "dispatcher-unavailable"; }
  return summary;
}
