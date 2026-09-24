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
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` | Used for canonical URLs and Open Graph tags. |
| `CRON_SECRET` | 32+ random bytes | `openssl rand -hex 32`. Authorizes `GET /api/cron/settle`. |

**Not** set in Vercel, because they are development-machine only:

| Variable | Why it stays off the deployment |
| --- | --- |
| `SUPABASE_DB_URL` | Direct Postgres connection string for migrations. The running app never touches it. |
| `SUPABASE_ACCESS_TOKEN` | Supabase **Management** API token (`sbp_...`). Used only by `scripts/db/*`. Keep it in your shell, never in `.env.local` either — `scripts/db/load-env.mjs` deliberately reads it from the process environment so it cannot be committed by accident. |

Build command, output directory and framework are left at their detected
defaults. Do not add a custom `install` command; `package-lock.json` is
committed and npm ci is used automatically.

## 2. Supabase: allow the deployed origin

Auth will silently fail until the deployed URL is permitted. In the Supabase
Dashboard → **Authentication → URL Configuration**:

1. **Site URL** → your production URL.
2. **Redirect URLs** → add, matching the callback exactly:
   - `https://<your-domain>/auth/callback`
   - `http://localhost:3000/auth/callback` (local development)

The callback route validates the `next` parameter against a single-slash,
non-absolute path, so it cannot be used as an open redirect.

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

## 5. Explicitly not configured

Payments are a documented seam, not a feature. `PaymentProvider` is implemented
by an honest `NoopPaymentProvider`: the sale, the platform fee and the seller
proceeds are recorded as `AWAITING_PAYMENT`, and the UI says so. **"Payment
successful" is never rendered** without a real provider confirming a charge. To
activate one, implement `src/server/payments/provider.ts` — no auction, fee or
transaction code changes.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Deploy rejected citing cron | Schedule is more frequent than once per day on a Hobby plan. See §3. |
| Sign-in loop, or `?error=callback` | Deployed origin missing from Supabase **Redirect URLs** (§2). |
| `SUPABASE_SECRET_KEY is not configured` | Secret missing from Vercel, or it was (incorrectly) prefixed `NEXT_PUBLIC_`. |
| Countdown shows 00:00:00 while the badge says Live | Stale row; a read-path sweep or the cron will close it. If it persists, check the cron's 401s — `CRON_SECRET` unset. |
