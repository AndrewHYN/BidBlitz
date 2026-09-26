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

**Deliberately not set — payment provider.** These are the only variables that
can make BidBlitz charge anyone, which is exactly why they are absent:

| Variable | Value | Notes |
| --- | --- | --- |
| `PAYNOW_INTEGRATION_ID` | from the Paynow dashboard | **Server only.** Unset in Vercel until the test-mode flow is verified (ADR-011). |
| `PAYNOW_INTEGRATION_KEY` | from "Email Key To Company Address" | **Server only.** Never `NEXT_PUBLIC_`, never logged. Only a SHA-512 hash derived from it ever leaves the server. |

Both must be present or neither: a partial configuration leaves the honest
`NoopPaymentProvider` in place and writes the reason to the server log. Adding
them activates checkout **and** the webhook in the same deployment, so do it in
one deliberate push, after reading ADR-011.

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
7. `POST /api/payments/webhook` with `{}` → **503** with
   `{"ok":false,"error":"no_payment_provider"}` (the honest Noop answer; §5).
8. `POST /api/payments/checkout` with `{"transactionId":"<any uuid>"}` →
   **503** `{"ok":false,"error":"no_payment_provider"}`, and the Transactions
   page shows **no** pay button (only a configured provider renders one).

## 5. Payment provider status and webhook contract

### Current state: nothing is configured, and that is the shipped state

Payments are a documented seam, not a feature. `PaymentProvider` is
implemented by an honest `NoopPaymentProvider`: the sale, the platform fee and
the seller proceeds are recorded as `AWAITING_PAYMENT`, and the UI says so.
**"Payment successful" is never rendered** without a real provider confirming a
charge, and no checkout button exists while none is configured.

Provider selection lives in exactly one module,
`src/server/payments/config.ts`:

| `PAYNOW_INTEGRATION_ID` / `PAYNOW_INTEGRATION_KEY` | Result |
| --- | --- |
| both absent (today) | `NoopPaymentProvider`; no boot error |
| exactly one present, or a value still matching the `.env.example` placeholder | stays `NoopPaymentProvider` **and** logs `paymentBootError()` — a half-set integration never looks like a working one |
| both present **and** `SUPABASE_SECRET_KEY` present | `PaynowPaymentProvider` |

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

**Write paths.** A provider reaches the database only through `ledger.ts`:

| Function | Transition | Guards |
| --- | --- | --- |
| `mark_transaction_paid` | `AWAITING_PAYMENT → PAID` | row lock, amount **and** currency equal to the recorded sale, `(provider, event_id)` dedupe, `already_paid` on replay |
| `mark_transaction_failed` | `AWAITING_PAYMENT → FAILED` | row lock, dedupe, `already_failed` on replay; **no** amount check — no money moved |
| `mark_transaction_refunded` | `PAID → REFUNDED` | row lock, dedupe, `already_refunded` on replay; provider reference fields untouched (written once, at `PAID`) |
| `record_payment_event` | *(none)* | audit row only, for authentic events that change no state (in-flight status, dispute) |

All four are `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` restricted to
`postgres` / `supabase_admin` / `service_role`. A browser redirect from the
provider's page has no path to any of them.

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

### Before going live with a provider

1. Run `npm run db:migrate` (the Phase 3 transition writers are additive).
2. Set both `PAYNOW_*` variables in Vercel — never in git, never in
   `.env.example` with a real value.
3. Re-run the post-deploy checks above: 8 flips from 503 to 503 *with a server
   log reason only if misconfigured*, and the pay button appears only on a
   transaction the signed-in buyer owns and is still awaiting payment.
4. Complete the test-mode proof list in ADR-011 (initiation, redirect,
   callback, signature, success, failure, cancel, duplicate callback, wrong
   amount, wrong currency, unknown transaction, replay) **before** requesting
   "Set Live" in the Paynow dashboard.
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
