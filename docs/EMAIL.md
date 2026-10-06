# Email — architecture, configuration, operations

BidBlitz sends transactional email through Resend. Supabase Auth stays exactly
as it is; only the mail transport changes. Email is a delivery channel on top
of database state, never the source of truth for it.

## Architecture

```
marketplace action commits (bid, settlement, decision, refund)
        |
        v  same server action, separate best-effort step
email_outbox row (idempotency_key, recipient, template, payload, QUEUED)
        |
        v  the daily cron sweep (05:00) claims and dispatches every
           row still QUEUED — there is no inline dispatch today
Resend API  --->  SENT / FAILED / SKIPPED (+ attempts, last error)
```

- **State first, mail second.** If enqueueing throws, the bid, settlement or
  decision stands. An email failure must never roll back marketplace state.
- **Idempotency keys are deterministic** (`template:entity:id`), and the
  unique constraint — not application memory — collapses retries and
  double-submits into one row.
- **Preferences gate optional mail only.** Critical mail (security, money,
  wins, cancellations, moderation decisions) always sends. Losing a "you won"
  email to an unchecked box would be a failure, not a preference.
- **Sending never throws into callers.** A send failure is recorded on the row
  (`attempts`, `last_error`) for the retry sweep, and an *enqueue* failure —
  which has no row to record against — is logged by `queueEmail` rather than
  dropped silently.
- **No credentials, no delivery claims.** Without `RESEND_API_KEY` the
  dispatcher leaves rows `QUEUED` and says why. Nothing pretends mail went out.

Code: `src/server/email/catalog.ts` (every template as data),
`src/server/email/layout.ts` (one email-safe document),
`src/server/email/sender.ts` (queue + dispatch),
`src/server/email/notify.ts` (recipient fan-out per event),
`src/app/api/email/dispatch/route.ts` (cron backstop).

## Required configuration

Application (Vercel → Environment Variables):

| Variable | Value | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | `re_...` from resend.com/api-keys | Server-side only. Never `NEXT_PUBLIC_`. |
| `EMAIL_FROM` | e.g. `BidBlitz <hello@bidblitz.co.zw>` | Must be a verified domain sender. |
| `APP_URL` | `https://bidblitz.co.zw` | Absolute links in every email CTA (the canonical origin). Falls back to the same value in code when unset. |

Supabase Auth SMTP (Dashboard → Authentication → Sign In / Up → SMTP Settings,
"Enable Custom SMTP"):

| Setting | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the same `re_...` API key |

> **OWNER ACTION — blocks signup volume.** This keeps confirmation enabled on
> the Free plan: the built-in provider is rate-limited to 2 emails/hour
> project-wide (see `docs/POST_LAUNCH_BACKLOG.md`), which blocks signups once
> spent. Custom SMTP removes that ceiling without any paid upgrade. Until the
> settings below are applied in the Supabase dashboard, this warning stays
> active — it is not fixed by any code change.

Resend (resend.com → Domains → Add Domain):

1. Add the sending domain and create the SPF, DKIM and DMARC records Resend
   shows. Sending from an unverified domain fails or lands in spam.
2. Create the API key and store it as above. Deleting a key revokes sending
   immediately; the outbox keeps queueing and the cron keeps reporting
   `no-resend-credentials` until a new key lands.
3. Development and testing may use Resend's permitted test sender where
   applicable; production must use the verified custom domain.

Cron backstop (`vercel.json`): `/api/email/dispatch` runs daily with the same
`CRON_SECRET` bearer as `/api/cron/settle`. It only delivers what the outbox
holds — it never creates mail. **This sweep is currently the only delivery
path**: nothing dispatches inline, so queued mail can wait up to ~24 hours
(a "you won" notification included). Inline dispatch in the actions that can
afford it is deferred work in `docs/POST_LAUNCH_BACKLOG.md`; it is a latency
limitation, not a data-loss one — the row stays `QUEUED` until it is sent.

## Templates

The catalogue is the contract: each entry knows its subject, body, CTA,
whether it is critical, and which preference gates it. Subjects name the item
(`You won: ${title} for ${amount}`); bodies carry one headline, short
paragraphs, one primary action, and receipt-style footnotes. No metrics, no
marketing language, no emojis. Adding an event is a catalogue entry plus a
`queueEmail` call at the code path that owns the event — never new
infrastructure. Covered events (20 templates): review
submitted/approved/rejected/changes, cancellation requested/decided, auction
paused/resumed/cancelled, listing removed, account suspended/restored, won,
outbid (optional), unsold, payment required/received/expired, team invite,
new message.

## Preferences (`/settings`)

Three optional toggles: outbid alerts (on), ending-soon (on), marketplace
activity (off). Everything else is critical and cannot be disabled. The
dispatcher reads the recipient's live row at send time; unknown recipients
fall back to safe defaults.

## Status today

Architecture, catalogue, outbox, dispatcher, preferences and the
delivery-failures SQL read path are implemented and unit-tested, and the
database queue is proven (`OB:` checks in `db:verify`). There is **no admin UI
for the outbox**: inspecting it means the SQL read path in
`supabase/migrations/20260930000003_email_outbox.sql`, or the `attempts` /
`last_error` columns directly.

Provider key verified 2026-09-30: a `RESEND_API_KEY` has been issued and a
live API test through it returned `200` with a Resend message id, so the key
authenticates and delivers. (Dated evidence — re-read the dashboards rather
than assuming this still holds.) Two things are still true:

- The test sent from Resend's permitted test sender. Sending from a Gmail
  address was refused (`gmail.com` is not verifiable): **production mail
  needs a verified custom domain** (Resend dashboard → Domains → SPF/DKIM/
  DMARC), then `EMAIL_FROM` becomes that domain sender.
- The key is not deployed anywhere yet: `RESEND_API_KEY`, `EMAIL_FROM` and
  `APP_URL` must be added in the Vercel dashboard (Environment Variables),
  and Supabase Auth custom SMTP (`smtp.resend.com:465`, user `resend`,
  password the API key) is still unconfigured — signup stays rate-capped
  until then.

> **OWNER ACTION.** Both items are dashboard/account work: an email provider,
> credentials and a verified sending domain. No code in this repository adds
> them, and none should. While they are outstanding, mail queues but does not
> send — which is the designed behaviour, not a failure — and the 2-per-hour
> built-in-mailer warning above remains a launch gate.

Until those two owner steps are done, mail queues but does not send — which is
the designed behaviour, not a failure.
