# Deploying BidBlitz to Vercel

The app is a standard Next.js 16 App Router project; Vercel detects it with no
build settings. What needs a human is the environment and the Supabase side.

> **Secrets rule:** `.env.local` is gitignored and stays that way. Only
> `.env.example` is tracked. Nothing with a real value is ever written into
> source, the README, or a screenshot.

## 1. Environment variables

Create the project in Vercel, then add these under
**Project → Settings → Environment Variables** for *Production, Preview and
Development*. Names must match `.env.example` exactly — the app reads them by
name and does nothing clever.

| Variable | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Public. Baked into the bundle at build time. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Public by design; safe to ship because RLS constrains every query it can make. |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | **Server only.** Never `NEXT_PUBLIC_`, never logged. Read in exactly one module (`src/lib/supabase/admin.ts`, guarded by `import "server-only"`). |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` | Used for canonical URLs and Open Graph tags. Also derives the Paynow `resulturl` / `returnurl` (§5), so it must be the canonical origin before a provider is configured. |
| `CRON_SECRET` | 32+ random bytes | `openssl rand -hex 32`. Authorizes `GET /api/cron/settle`. |

**Payment provider — Production secrets, set 2026-09-26.** These are the only
variables that can make BidBlitz charge anyone, which is why they live in Vercel
and never in git:

| Variable | Value | Notes |
| --- | --- | --- |
| `PAYNOW_INTEGRATION_ID` | from the Paynow dashboard | **Server only.** Production secret, set 2026-09-26; the integration is in Paynow **test mode**. |
| `PAYNOW_INTEGRATION_KEY` | from "Email Key To Company Address" | **Server only.** Never `NEXT_PUBLIC_`, never logged. Only a SHA-512 hash derived from it ever leaves the server. Rotate it ("Generate New Key") after it has been used in testing. |

Both must be present or neither: a partial configuration leaves the honest
`NoopPaymentProvider` in place and writes the reason to the server log. Both are
present in Production, so checkout **and** the webhook are live in that
deployment — ADR-011 records what that verified and what it did not (Paynow's
status-update push never arrived in test mode).

**Not** set in Vercel, because they are development-machine only:

| Variable | Why it stays off the deployment |
| --- | --- |
| `SUPABASE_DB_URL` | Direct Postgres connection string for migrations. The running app never touches it. |
| `SUPABASE_ACCESS_TOKEN` | Supabase **Management** API token (`sbp_...`). Used only by `scripts/db/*`. Keep it in your shell, never in `.env.local` either — `scripts/db/load-env.mjs` deliberately reads it from the process environment so it cannot be committed by accident. |

Build command, output directory and framework are left at their detected
defaults. Do not add a custom `install` command; `package-lock.json` is
committed and npm ci is used automatically.

### Domain truth (this project)

| Role | URL | Notes |
| --- | --- | --- |
| Production / canonical | `https://bid-blitz-ten.vercel.app` | The project's only domain (Project → Domains). Pushes to `main` build and promote here. |
| Frozen deployment URL | `https://bid-blitz-q9l25rfxv-andrewhyn.vercel.app` | Immutable URL of one earlier deployment. It cannot be aliased or updated — `vercel alias set` refuses deployment URLs — so it is permanently frozen at that build and its then-current env. Never link users here. |

`NEXT_PUBLIC_SITE_URL` is `https://bid-blitz-ten.vercel.app/`. Vercel snapshots
environment variables **per deployment**, so a changed value only takes effect
from the next git push onward (it is inlined into the bundle at build time). It
drives canonical URLs, Open Graph tags, and the sign-up confirmation
`emailRedirectTo` (`src/server/actions/auth.ts`).

## 2. Supabase: allow the deployed origin

Auth will silently fail until the deployed URL is permitted. In the Supabase
Dashboard → **Authentication → URL Configuration**:

1. **Site URL** → your production URL.
2. **Redirect URLs** → add, matching the callback exactly:
   - `https://<your-domain>/auth/callback`
   - `http://localhost:3000/auth/callback` (local development)

The callback route validates the `next` parameter against a single-slash,
non-absolute path, so it cannot be used as an open redirect.

This project's live values, read back through the Management API
(`GET /v1/projects/{ref}/config/auth`):

- **Site URL** = `https://bid-blitz-ten.vercel.app` — the canonical production
  domain (§1). It is the fallback landing when no explicit
  `emailRedirectTo` is honoured. Confirmation links pass
  `emailRedirectTo = ${NEXT_PUBLIC_SITE_URL}/auth/callback`
  (`src/server/actions/auth.ts`): production resolves it from the Vercel env,
  local dev from the gitignored `.env.local`
  (`NEXT_PUBLIC_SITE_URL=http://localhost:3000`). The Site URL was moved off
  the frozen deployment URL to production during the launch pass (Phase 17)
  with a single `PATCH /v1/projects/{ref}/config/auth` and confirmed by
  read-back.
- **Redirect URLs** (the `uri_allow_list` field, comma-separated) =
  `https://bid-blitz-ten.vercel.app/**,https://bid-blitz-q9l25rfxv-andrewhyn.vercel.app/**,https://bid-blitz*-andrewhyn.vercel.app/**,http://localhost:3000/**`
  — production first, then every pre-existing pattern **preserved verbatim**.
  Note the correction: the older `bid-blitz*-andrewhyn.vercel.app/**` wildcard
  does **not** cover the production alias (it lacks the `-andrewhyn` suffix),
  which is why the explicit production pattern was prepended rather than
  assumed. A redirect outside this list is rejected by GoTrue, so any future
  domain (e.g. a custom domain) must be added here as well as in Vercel.

Two details worth keeping:

- The `**` is load-bearing: GoTrue compiles the patterns with `.` and `/` as
  glob separators, so a single `*` cannot cross the `/auth/callback` path
  boundary. All four patterns stay on origins this project controls
  (production, its own Vercel previews, localhost), so a confirmation link can
  never hand tokens to a foreign host.
- **Leaked-password protection (HaveIBeenPwned) is not enabled.** The API
  answers `HTTP 402` — the feature is gated to Pro plans and up. It remains
  the one `auth_leaked_password_protection` advisor warning; see ADR-010.

Confirm the project's email settings match the intended signup behaviour: the
project ships with **email confirmation ON**, which means `signUpAction` returns
success *without* a session and the UI shows a truthful "check your email"
panel rather than pretending the user is signed in.

## 3. Cron

`vercel.json` schedules:

```json
{ "path": "/api/cron/settle", "schedule": "0 4 * * *" }
```

**Why daily and not every minute:** Vercel **fails the deployment** if a
Hobby-plan project declares a cron expression that runs more than once per day.
A minute-level schedule would therefore make the project undeployable on the
free tier, so the safe-by-default value ships.

This costs nothing in correctness. Settlement has three redundant triggers —
the bid path, a throttled reconcile-on-read sweep, and this cron (ADR-008) — so
no auction can be left stuck in `LIVE`. Cron only makes the *announcement*
prompt for auctions nobody is watching. On a paid plan, change that one line to
`* * * * *`; nothing else changes.

Vercel sends the cron request as `Authorization: Bearer ${CRON_SECRET}`. The
route refuses everything when `CRON_SECRET` is unset (it will not accept
`Bearer undefined`), which degrades to a 401 rather than an unauthenticated
sweep.

**Retrieval gotcha:** if the variable was created with `visibility: secret`,
`vercel env pull` writes the literal placeholder `[SENSITIVE]` instead of the
value — sending that placeholder gets a 401 and looks like a broken cron.
Environment changes are also snapshotted per deployment, so after any rotation
you must create a **new deployment** (a git push; CLI redeploys do not take the
production alias) before the route accepts the new value. Keep the value in the
gitignored `.env.local` for local verification, exactly like
`.env.example` describes.

## 4. Post-deploy verification

Run these against the deployed URL before calling it shipped:

1. `GET /api/time` → `{"now": "..."}` — the clock oracle the countdowns sync to.
2. `GET /api/cron/settle` with no auth → **401**. With the wrong bearer → 401.
   With `Authorization: Bearer $CRON_SECRET` → `{"ok": true, ...}`.
3. Home page renders live auctions; a card never shows a `Live` badge beside a
   zero countdown.
4. Sign up with a fresh address → "check your email" panel (not a fake
   auto-login), then confirm and sign in.
5. Place a bid from two sessions → the loser gets outbid feedback, the loser's
   bid never appears as the current price.
6. `GET /auction/<id>` HTML → `og:url` and the `rel=canonical` link start with
   `NEXT_PUBLIC_SITE_URL` (a stale domain means the env change predates the
   running build: environment snapshots are per deployment, so push again).
7. `POST /api/payments/webhook` with `{}` → **400**
   `{"ok":false,"error":"invalid_json"}` now that a provider is configured
   (**503** `no_payment_provider` only while none is). `GET` on the same URL →
   **200** probe response that writes nothing.
8. `POST /api/payments/checkout` with `{"transactionId":"<any uuid>"}` and no
   session → **401** `{"ok":false,"error":"unauthenticated"}` (**503** only
   while no provider is configured), and the Transactions page shows a pay
   button only while a provider is configured.

## 5. Payment provider status and webhook contract

### Current state: Paynow configured in Production, in test mode

Payments are wired, not merely a seam. `PAYNOW_INTEGRATION_ID` and
`PAYNOW_INTEGRATION_KEY` are **Production secrets** (set 2026-09-26), so
`config.ts` boots `PaynowPaymentProvider`: checkout returns a real Paynow
payment page and the webhook verifies Paynow's signature. The integration is
in Paynow **test mode**. What has *not* changed: **"Payment successful" is
never rendered** from a redirect — only a signed provider message can reach
`AWAITING_PAYMENT → PAID`, and Paynow's status-update push was never observed
arriving (ADR-011).

Provider selection lives in exactly one module,
`src/server/payments/config.ts`:

| `PAYNOW_INTEGRATION_ID` / `PAYNOW_INTEGRATION_KEY` | Result |
| --- | --- |
| both absent | `NoopPaymentProvider`; no boot error |
| exactly one present, or a value still matching the `.env.example` placeholder | stays `NoopPaymentProvider` **and** logs `paymentBootError()` — a half-set integration never looks like a working one |
| both present **and** `SUPABASE_SECRET_KEY` present | `PaynowPaymentProvider` — the state of Production since 2026-09-26 |

Research, verified capabilities and open questions: **ADR-011** in
`docs/ARCHITECTURE_DECISIONS.md`.

### `POST /api/payments/webhook`

Deliberately *unauthenticated by Bearer secret* — webhook authentication is the
provider's signature scheme, verified inside
`PaymentProvider.confirm(payload, { rawBody, headers })` **before any field of
the message is believed**. The raw body is passed through byte-for-byte so the
signature hashes exactly what was transmitted.

**Encodings accepted.** The body is pre-checked structurally, not by
`Content-Type`: a `{...}` body is parsed as JSON (malformed → `invalid_json`),
a `key=value...` body is parsed as form-encoded (Paynow's encoding), anything
else → `unsupported_body`.

**Exact responses:**

| Status | Body | When |
| --- | --- | --- |
| **200** | `{"ok":true,"method":"GET",...}` | `GET` reachability probe (Paynow GETs `resulturl` at initiation). Reads no body, consults no provider, writes nothing. |
| **503** | `{"ok":false,"error":"no_payment_provider"}` | No provider configured. Checked **before the body is read**. |
| **400** | `{"ok":false,"error":"empty_body"}` | Zero-length or whitespace-only body. |
| **400** | `{"ok":false,"error":"invalid_json"}` | Body starts like JSON and does not parse. |
| **400** | `{"ok":false,"error":"unsupported_body"}` | Neither JSON object nor form message. |
| **400** | `{"ok":false,"error":"invalid_signature"}` | Signature did not verify — nothing was believed, nothing was written. |
| **400** | `{"ok":false,"error":"unknown_transaction"}` | Not a transaction id we have. |
| **400** | `{"ok":false,"error":"amount_mismatch"}` | Amount **or** currency differs from the recorded sale (same guard, same message). |
| **400** | `{"ok":false,"error":"invalid_transition"}` | The event would require a transition outside the allowlist (e.g. `PAID → FAILED`). |
| **400** | `{"ok":false,"error":"malformed_payload"}` | Well-formed envelope, unreadable or missing required fields. |
| **400** | `{"ok":false,"error":"unrecognized_payload"}` | Provider recognised it as "not for us" (`confirm` → `handled: false`). |
| **200** | `{"ok":true}` | Verified and accounted for. Deliberately contains no `status`/`paid` field: **200 never means "the sale is paid"**. |
| **500** | `{"ok":false,"error":"webhook_failed"}` | Unexpected handler failure. Logged **without** the payload (it may carry buyer details). |

Retry semantics: Paynow resends a status update up to **ten times** when the
response is an HTTP error status, so 400 and 500 both cause a bounded retry —
they differ in meaning (permanent rejection vs. try again), not in whether the
handler is safe to re-enter. Every re-entry is idempotent by construction.
In test mode no status update ever arrived to retry against; the observed
behaviour is recorded in ADR-011.

**Write paths.** A provider reaches the database only through `ledger.ts`:

| Function | Transition | Guards |
| --- | --- | --- |
| `mark_transaction_paid` | `AWAITING_PAYMENT → PAID` | row lock, amount **and** currency equal to the recorded sale, `(provider, event_id)` dedupe, `already_paid` on replay |
| `mark_transaction_failed` | `AWAITING_PAYMENT → FAILED` | row lock, dedupe, `already_failed` on replay; **no** amount check — no money moved |
| `mark_transaction_refunded` | `PAID → REFUNDED` | row lock, dedupe, `already_refunded` on replay; provider reference fields untouched (written once, at `PAID`) |
| `record_payment_event` | *(none)* | audit row only, for authentic events that change no state (in-flight status, dispute) |
| `record_payment_intent` | *(none)* | writes the provider's **session** URL (`payment_intents`) only — never a status. Re-initiation replaces the row; an unknown transaction id is refused |

All five are `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` restricted to
`postgres` / `supabase_admin` / `service_role`. A browser redirect from the
provider's page has no path to any of them.

`payment_intents` mirrors `payment_events`: RLS enabled, **no policies**, and
`anon` / `authenticated` have no table grant at all. It holds Paynow's `pollurl`
(a capability token for reading payment status), so nothing outside the server
can read it — and it is never a source of payment truth, only an address the
server may ask.

### `POST /api/payments/checkout`

Starts a payment intent for the **buyer of record** only. The amount and
currency are read from the transaction row, never from the request body; there
is no write path to `transactions` at all.

| Status | Body |
| --- | --- |
| **503** | `{"ok":false,"error":"no_payment_provider"}` (checked first, before any work) |
| **429** | `{"ok":false,"error":"rate_limited"}` (8 requests/minute per client IP) |
| **400** | `invalid_request`, `unsupported_currency`, or a provider-side rejection reason |
| **401** | `unauthenticated` |
| **403** | `not_the_buyer` |
| **404** | `transaction_not_found` (RLS hides rows the caller is not a party to) |
| **409** | `not_awaiting_payment` |
| **502** | `provider_error` (the provider refused, errored, or returned no payment page) |
| **500** | `checkout_failed` |
| **200** | `{"ok":true,"provider","transactionId","redirectUrl"}` — an invitation to go and pay, nothing more |

### `POST /api/payments/reconcile`

The **fallback**, not a second settlement path. `resulturl` (the webhook)
remains the primary signal; this endpoint exists because a status update that
never arrives must not leave a paid-for sale stuck in `AWAITING_PAYMENT`.

- The server fetches the `pollurl` stored at initiation (`payment_intents`) —
  only server-side code ever calls it, over HTTPS to `*.paynow.co.zw` only.
- The reply is authenticated with Paynow's own hash **before** any field is
  believed, then checked against the row: reference must be this transaction,
  amount must equal the recorded sale, currency must be one Paynow settles.
- The result goes through the same row-locked, idempotent `ledger.ts` path the
  webhook uses, so `(provider, event_id)` dedupe still applies and `PAID` is
  never downgraded.
- The response reports the status **re-read from Postgres after** the provider
  ran, so the UI converges on the database rather than on Paynow's opinion.
- Only an explicit request triggers it: no timer, no cron, no queue. Rate
  limited to 6 requests/minute per client IP **and** per transaction.

| Status | Body |
| --- | --- |
| **503** | `no_payment_provider` (checked first) |
| **501** | `reconciliation_unsupported` (the configured provider publishes no status endpoint) |
| **429** | `rate_limited` |
| **400** | `invalid_request`, `invalid_signature`, `amount_mismatch`, `reference_mismatch`, `currency_mismatch`, `no_poll_url`, `invalid_poll_url`, `malformed_payload`, `unrecognized_payload` |
| **401** | `unauthenticated` |
| **403** | `not_a_party` |
| **404** | `transaction_not_found` (RLS) |
| **502** | `provider_unreachable`, `provider_error` — nothing was read, so nothing changed |
| **500** | `reconcile_failed` |
| **200** | `{"ok":true,"status","reconciled","outcome","providerStatus","changed"}` where `status` is the Postgres row. A row that is no longer `AWAITING_PAYMENT` answers `{"ok":true,"status","reconciled":false,"reason":"already_final"}` **without contacting Paynow** |

The request body carries only `transactionId`. Any `status` / `amount` /
`paid` field in it is ignored outright — the browser is the party with the
most to gain from inventing one.

### Before going live with a provider

1. Run `npm run db:migrate` (every migration is additive: transition writers,
   then the `payment_intents` poll-address table).
2. Confirm both `PAYNOW_*` variables are set in Vercel (Production secrets —
   they were added 2026-09-26) — never in git, never in `.env.example` with a
   real value.
3. Re-run the post-deploy checks above: 7 answers `400 invalid_json` with a
   provider configured (503 only if misconfigured), 8 answers `401
   unauthenticated` without a session, and the pay button appears only on a
   transaction the signed-in buyer owns and is still awaiting payment.
4. The test-mode proof list ran on 2026-09-26 and the reconciliation proof ran
   on 2026-09-27 — results are in ADR-011. **Before** requesting "Set Live":
   establish with Paynow that status updates will actually be delivered to
   `resulturl` (none arrived across eight initiations; the `pollurl`
   reconciliation fallback is implemented and proven live as the mitigation),
   then re-run the list.
5. Do not add a shared-secret env var alongside the signature scheme — a
   secret with no verifier is theater.

## 6. Vercel Deployment Protection (SSO) — why every URL 302s

If **every** path on the production domain — `/`, `/api/time`, the cron route —
answers `302 Location: https://vercel.com/sso-api?...` and the browser lands on
a "Protected Deployment" login page, the application never ran. That response
is issued by Vercel's edge, before any function or page is invoked. It is a
platform setting, not an app or auth bug: nothing in `middleware`, the API
routes or Supabase can see or fix it.

Inspect the live state (authenticated CLI, `vercel login` first if needed):

```sh
vercel project protection bid-blitz --format json
```

On this project the initial (pre-QA) state was:

```json
{ "ssoProtection": { "deploymentType": "all_except_custom_domains" },
  "gitForkProtection": true }
```

`all_except_custom_domains` protects every `*.vercel.app` deployment —
production included — so the site, `/api/time` and `GET /api/cron/settle` are
all unreachable for users and for Vercel's own cron.

To make production public while keeping previews gated, PATCH the project with
a token that can edit it (the CLI credential store works:

`%APPDATA%\com.vercel.cli\Data\auth.json` → `token`, process env only):

```sh
PATCH https://api.vercel.com/v9/projects/<projectId>
{ "ssoProtection": { "deploymentType": "preview" } }
```

(`vercel project protection disable <name> --sso` is the CLI toggle for the
same setting; `preview` is preferred over a full disable so preview
deployments stay protected.) Verify with the `project protection` command
above, then re-run the §4 smoke checks. `gitForkProtection` is unrelated and
stays on.

> **Verified release state (release audit 2026-09-25):** `deploymentType` is
> `preview` — production (`bid-blitz-ten.vercel.app`) is publicly reachable for
> real users while preview deployments stay protected, and `gitForkProtection`
> stays on. This is the intended launch state; release QA (HTTP smoke, Playwright
> desktop + mobile, visual pass) ran against the live domain in exactly this
> state. If `all_except_custom_domains` is ever set again, production on
> `*.vercel.app` is gated (302 to `vercel.com/sso-api`) and the site must not be
> described as publicly live until it is switched back with the PATCH above.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Every URL 302s to `vercel.com/sso-api` | Vercel Authentication enabled for the deployment. Platform setting — §6, not application code. |
| Deploy rejected citing cron | Schedule is more frequent than once per day on a Hobby plan. See §3. |
| Sign-in loop, or `?error=callback` | Deployed origin missing from Supabase **Redirect URLs** (§2). |
| `SUPABASE_SECRET_KEY is not configured` | Secret missing from Vercel, or it was (incorrectly) prefixed `NEXT_PUBLIC_`. |
| Countdown shows 00:00:00 while the badge says Live | Stale row; a read-path sweep or the cron will close it. If it persists, check the cron's 401s — `CRON_SECRET` unset. |
