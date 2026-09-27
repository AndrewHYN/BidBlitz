# BidBlitz Post-Launch / Paid Upgrade Reminder

This project is intentionally designed to launch on the current free-tier setup first.

## PAY FOR LATER — DO NOT BLOCK MVP

### Supabase paid-tier upgrades
Revisit when revenue/users justify them:
- Enable leaked-password protection if the chosen Supabase plan supports it.
- Review paid database/storage bandwidth limits as usage grows.
- Consider production branching/development environments if the team grows.
- Review realtime/database usage as simultaneous auctions scale.
- Consider additional observability/database capacity only when needed.

### Vercel paid-tier upgrades
Revisit when revenue/traffic justifies them:
- More frequent cron schedules if required for operational convenience.
- Higher execution/resource limits.
- Advanced analytics/observability.
- Team/enterprise controls if needed.

### Rate limiting
Current MVP can use a documented lightweight approach.
When traffic requires it, move to a distributed/serverless rate limiter or another durable shared mechanism.

### Signup capacity — a launch blocker, not a growth problem
Verified 2026-09-28 against this Supabase project's Auth configuration:

| Setting | Value |
| --- | --- |
| Custom SMTP provider | **not configured** (built-in Supabase email service) |
| `rate_limit_email_sent` | **2 per hour, project-wide** |
| `mailer_autoconfirm` | `false` — confirmation is ON and stays ON |

A signup sends a confirmation email, so the whole marketplace shares two
confirmation emails an hour. Once that is spent, GoTrue refuses **every**
subsequent signup with `over_email_send_rate_limit`. This is what a real user
hit as "Too many attempts. Try again later."

Two distinct things are true here, and conflating them is what made the original
report misleading:

- **Fixed in BidBlitz (`7624540`):** the provider refusal was being rendered in
  BidBlitz's *own* limiter's wording and was also spending BidBlitz's failure
  budget, so retries compounded it. The two throttles are now distinct in the
  UI and a provider throttle costs nothing of ours.
- **Not fixable in BidBlitz:** the two-per-hour budget. Configuring a real SMTP
  provider in Supabase (*Project Settings → Authentication → Email*) is what
  raises it, and that needs the owner's own provider account and credentials.
  Tracked as gate K0 in `docs/COMPLIANCE_LAUNCH_CHECKLIST.md` §0.

Consequence: **a new visitor cannot create an account at all until the mailer is
configured.** The Playwright signup test skips itself with the provider-throttle
message rather than reporting a false pass, so this must not be mistaken for a
green suite proving signups work.

### Payments
MVP deliberately does not fake payment.

Phase 3 moved this from "unimplemented" to "researched and built behind a
seam" (see **ADR-011**); on 2026-09-26 the provider was switched **on** in
Production (Paynow test mode) and the ADR-011 proof list ran against the live
site. Completed: provider abstraction
(`PaymentProvider` with Noop/Paynow implementations), webhook signature
verification over the raw body, amount/currency/reference re-checks, event
dedupe and replay protection, the allowlisted state machine with
service-role-only writers, a buyer checkout route, and the sandbox proof list.
Still open — and therefore **not claimed**:

- **End-to-end delivery.** The proof list passed on 2026-09-26: a genuine
  Paynow-signed callback moved `AWAITING_PAYMENT → PAID`, a cancelled payment
  moved `→ FAILED`, duplicates and tampered replays were rejected, and
  unsigned forgeries were rejected (evidence in **ADR-011**). What it did
  *not* establish: Paynow never delivered a status update to `resulturl`
  (5 test transactions, zero POSTs), so **delivery** is still open — see
  *Paynow status-update delivery* below. A server-side fallback now exists so
  a silent push cannot strand a sale (`payment_intents` stores `pollurl` at
  initiation; `POST /api/payments/reconcile` asks Paynow directly on an
  explicit request — see **DEPLOYMENT.md**), but the fallback is a fallback:
  it does not make the push work and must not be described as if it did.
- **Refunds as a real operation.** `PAID → REFUNDED` exists, is tested and is
  reachable only by service role, but Paynow's published reversal endpoint is
  BillPay-only and "a very limited set of billers accept reversals". The
  endpoint for an advanced-integration merchant must be confirmed in test mode.
- **Dispute handling.** `Disputed` is recorded in the payment audit log and
  changes no state. No flow exists beyond that.
- **Cancellation.** Paynow publishes no server-initiated cancellation
  endpoint, so `cancel()` refuses rather than pretending.

Before enabling real buyer/seller money movement:
- confirm Paynow will deliver status updates to `resulturl`. The `pollurl`
  fallback is now built, so a silent push degrades to an explicit server-side
  reconciliation instead of a stranded sale — but delivery itself is still
  unproven (ADR-011, DEPLOYMENT.md),
- **confirm in writing that Paynow permits the multi-seller / manual-payout
  model at all** (`docs/PAYNOW_MARKETPLACE_SUPPORT_REQUEST.md`, point 5). Until
  it does, the platform has a payment integration but no confirmed right to
  operate as a marketplace on it,
- the payout/settlement *record* now exists (ADR-012); the settlement
  *permission* and the refund *mechanism* do not,
- add refunds/disputes once confirmed against the real API,
- review legal/regulatory obligations (`docs/COMPLIANCE_LAUNCH_CHECKLIST.md`).

### Payouts (money path, stated plainly)
Today the money path is: **buyer → Paynow → the platform's registered
Zimbabwean bank account**, less Paynow's transaction fee. BidBlitz records a
5% platform fee and the seller's proceeds in integer minor units, but **nothing
transfers to a seller automatically**. There is no seller payout API in Paynow
Zimbabwe, no escrow, and no split-payment support — the `transfers[]` split API
belongs to Paynow *Poland* (ING), a different company. Any onward payment to a
seller is a separate, manual administrative process (currently: platform-side
bank transfer), and must not be described as an automated payout.

**Built 2026-09-28 (see ADR-012):** the *record* of that manual process now
exists and is enforced by the database — `seller_payouts`, created automatically
when a transaction reaches `PAID`, with the seller's proceeds frozen from
`net_minor`, its own fulfilment/payout status, an append-only audit trail, and
an admin-only operations queue at `/admin`. Nothing in this moves money and
nothing in it is automated settlement; it records what a human did.

Still open for payouts:
- **Paynow marketplace approval.** Nothing in writing says Paynow permits a
  merchant to collect buyer funds for third-party sellers and make onward
  payments to them in a manual model. Query drafted in
  `docs/PAYNOW_MARKETPLACE_SUPPORT_REQUEST.md` (point 5); **not sent, no
  response.** This is a launch blocker, not a backlog nicety.
- **Seller payment details are not collected at all.** No product field, no
  database column, no upload. Payouts are made out of band. Storing seller bank
  details raises real security and legal obligations and must be a deliberate
  decision, not a feature — and it should wait until Paynow has confirmed what
  documentation a seller must provide (same document, point 6).
- **Payout reconciliation has no tooling.** The comparison described in
  `docs/MARKETPLACE_OPERATIONS.md` §9 is a manual weekly routine today.
- **No fee ledger export.** Platform fee revenue is frozen per transaction in
  Postgres and exported to nothing.

### External checklist — Paynow (BLOCKERS, not engineering)
Tracked in full in `docs/COMPLIANCE_LAUNCH_CHECKLIST.md` §I. None of these can
be closed by writing code, and none may be described as closed:
- **Marketplace model approval in writing** (collect for third-party sellers,
  onward manual payouts) — no response.
- **`resulturl` status delivery** — eight test-mode initiations, zero POSTs.
  `pollurl` reconciliation works and is the proven path; `resulturl` remains
  the primary signal and remains unproven.
- **Refund mechanism for an Advanced Integration merchant** — none confirmed.
- **Merchant verification status and settlement timing** — unknown.
- **"Set Live" requirements** — unknown; do not request before the two above.

### Future monetization
Potential post-launch revenue:
- successful-sale platform fee
- featured auction/boost
- professional seller/dealer accounts
- analytics tools
- promoted listings
- transaction/payment services

Do not build these prematurely if they slow down proving the marketplace.

### Support BidBlitz / "coffee" tip (pre-launch audit Phase 8 — deferred, not built)

**Still deferred. Re-confirmed 2026-09-28, and the reason is now sharper.** The
5% sale fee remains the business model and is the only thing being planned
around. A tip is not built, and will not be, until all of the following are
true:

- the primary auction money flow is live — i.e. a real buyer has paid a real
  winning bid on a real sale, in live mode, and the seller has been paid from
  it,
- seller payouts are operational — i.e. an operator has actually run the
  fulfilment → payout due → manual transfer → record reference cycle, not just
  exercised it in a test harness,
- the marketplace is stable: Paynow's marketplace model and `resulturl`
  delivery are both settled in writing (`docs/COMPLIANCE_LAUNCH_CHECKLIST.md`
  §I).

Adding a second money flow to a marketplace whose primary money flow is still
in test mode multiplies unproven surface for no revenue, and a "support" payment
that is not audited with its own references can contaminate the fee and payout
records the real business depends on.

Considered for launch: a subtle "Support BidBlitz" link that lets happy users
send a small thank-you payment. Deferred, not built, because:

- the Paynow integration is still in test mode and has never completed a live
  payment end-to-end — adding a second payment flow would multiply unproven
  surface right before launch;
- a tip is not an auction payment: it needs its own reference namespace and
  intent/ledger rows (so fee and revenue reporting stay honest), its own
  amount-entry UI, cancel/refund rules, and copy that clearly separates it
  from bidder money — real scope, not a footer button;
- the rule for this pass was to ship it only with a real, clearly-labelled,
  separate payment flow; otherwise record the deferral. That rule is
  recorded here.

Placement rules when it is eventually built: footer / Help / account area
only — never beside bid buttons, auction cards, checkout, pop-ups or
banners; a real icon (no emoji); honest copy; zero fabricated counts (no
"X coffees bought"). The 5% sale fee remains the business model; a tip
stream is optional generosity, not revenue to plan around.

## DEFERRED IN THE COMMERCIAL PASS (PHASE 2 — P2/P3, intentional)

Carried out of the "Phase 2: Revenue + Marketplace Growth + Premium UX" pass.
Everything classified P0/P1 was implemented (payment webhook seam, fee
disclosure, publish/share flow, ending-soon + review-request notifications,
trust facts, buying-page payment state). What follows was judged safe to wait:

### Payment provider research (research only — nothing activated)
- **Provider choice for Zimbabwe / target market** — research candidate
  providers (e.g. Paynow, InnBucks, EcoCash aggregators for local rails;
  Stripe only where officially supported) and compare settlement, KYC,
  fees and webhook signature schemes. Decision required before any code
  activates a provider: no provider is hard-coded anywhere today, and
  `NoopPaymentProvider` remains the configured default.
- **Webhook signature verification** — `POST /api/payments/webhook` now
  forwards the raw body + headers to the provider seam (`WebhookContext`),
  but with no provider configured there is nothing to verify yet. The
  provider integration must implement constant-time signature checks there
  before trusting any payload.
- **Payouts / seller disbursement** — the 5% fee and `net_minor` split are
  computed and frozen server-side, but moving money to sellers needs the
  provider plus payout, refund and dispute rules.
- **Idempotent provider checkout UI** — `createIntent` is plumbed and
  typed, but no buyer-facing payment sheet exists while the provider is
  the Noop one (showing one would fake payment progress).

### Product/UX deferrals
- **`/sell/preview` route** — "Preview as a buyer" links to the draft
  detail page as the signed-in seller; a separate shareable preview route
  (for showing a draft to someone else) needs draft-access tokens.
- **Draft price editing** — terms freeze at publish by design (bidder
  fairness); editing starting bid/increment on an existing draft from the
  dashboard requires its own validation path.
- **Character counters on /sell** — server validation shows exact errors
  on submit; live counters were judged noise for a five-field form.
- **Live fee on the help page** — the fee is displayed from live
  `fee_settings` in the sell funnel and transactions; the help page keeps
  prose until the number can be shown without duplication risk.
- **Notification batching** — each event inserts one row today. If volume
  grows, batch NEW_BID bursts per auction before display.
- **Unread-count from the client** — the badge reads server-rendered
  counts; a client-side realtime unread counter needs careful RLS review.
- **e2e coverage for new flows** — share button, publish success panel,
  ending-soon producer and review deep links are covered by unit/engine
  checks; add end-to-end cases alongside the next e2e expansion.

### Analytics / observability (optional, never blockers)
- PostHog/Sentry (free-tier compatible) may be added later. Until real
  events exist, no charts or dashboards are drawn — no fake metrics, ever.
- Candidate event list to wire up when analytics is enabled:
  `auction_published`, `bid_placed`, `bid_rejected:<reason>`,
  `auction_settled`, `watch_toggled`, `share_clicked:<channel>`,
  `review_submitted`, `notification_opened:<type>`.

### Infrastructure limits that stay free-tier
- Vercel Hobby cron runs **once per day**; the settle sweep therefore also
  runs on viewer countdown expiry, on bid attempts over ended auctions,
  and via in-app throttles (one per minute). Ending-soon notices ride the
  same triggers and are deduped once per auction per user in the database.
- Rate limiting stays the documented in-memory/DB approach; a distributed
  limiter needs external infrastructure.

## DEFERRED IN THE LAUNCH PASS (P3 — intentional, not blockers)

Carried out of the "BidBlitz Launch/Product Pass" audit; each is safe to leave
until there is a reason:

- **Auth allow-list cleanup** — `uri_allow_list` keeps the two
  `*-andrewhyn.vercel.app` patterns for the frozen deployment URL (§ DEPLOYMENT
  domain truth). When that URL is permanently retired, delete both; keep the
  production and localhost patterns.
- **Manual confirmation-email check** — Supabase redirect acceptance for
  production is verified by Management API read-back (config is authoritative),
  but a full round-trip means receiving one real confirmation email. Do it once
  by signing up on production: the link must land on
  `https://bid-blitz-ten.vercel.app/auth/callback`, not the site root.
- **E2E gap: price filters → URL params** — browse price inputs now edit in
  dollars but write minor units to the URL (server contract). No e2e covers
  that translation yet; add one alongside any future filter work.
- **E2E gap: realtime connection banner** — the offline/stalled banner
  (`realtime-connection-banner`) needs a simulated channel failure; not covered
  by the current suite.
- **E2E gap: review flow** — leaving a review needs a settled transaction with
  two accounts and a revalidated table; not covered by the current suite.
- **Review policy when payments land** — today any transaction row can be
  reviewed (matching RLS). Once real payments exist, decide whether refunded or
  failed transactions should hide the review affordance.

## DEFERRED IN THE PAYMENT PASS (P3 — intentional, not blockers)

Delivered since: **intent (`pollurl`) persistence** — deferred in P3 "until a
real callback shows what needs correlating", and the condition was met the same
day (a genuine signed callback arrived). The schema change it was avoiding is
now `20260927000001_payment_intent_poll_url.sql`, and the fallback it enables is
`POST /api/payments/reconcile` (2026-09-27).

- **Paynow test-mode verification** — completed 2026-09-26: `PAYNOW_*` are
  Production secrets and the ADR-011 proof list passed (callback accepted,
  `→ PAID`, cancel `→ FAILED`, duplicate and tampered replays rejected,
  forgeries rejected). Outstanding from that run: **Paynow's status-update push
  never arrived** — see *Paynow status-update delivery* below.
- **Paynow status-update delivery** — across seven test transactions (eight
  initiations: six on 2026-09-26, two on 2026-09-27) Paynow recorded every
  payment as Paid/Cancelled/Created and never POSTed to `resulturl`, even after
  the endpoint answered its GET probe with 200. `pollurl` did answer and
  returned the same signed message shape, and is how the verification callbacks
  were obtained. Before real money: ask Paynow why (the support packet is
  drafted in ADR-011, *Information prepared for Paynow support*). The `pollurl`
  fallback is implemented **and proven live** (2026-09-27 — `payment_intents` +
  `POST /api/payments/reconcile` moved a genuinely completed hosted payment to
  `PAID` on production with exactly one audit event), so a silent push no
  longer strands a transaction; the push itself remains the primary signal and
  is still undelivered.
- **Custom domain** — production is `https://bid-blitz-ten.vercel.app`.
  Registering a domain is a deliberate, paid, human decision and is recorded
  here so it is not forgotten; do not purchase one as part of engineering work.
  When it happens: point the domain, update `NEXT_PUBLIC_SITE_URL` (which also
  rewrites the Paynow `resulturl`/`returnurl`), and re-run the canonical-URL
  smoke check.
- **Seller payout automation** — see *Payouts* above. No API exists in the
  chosen market; payouts stay manual and platform-administered.
- **Dispute and refund operations** — the states and writers exist; the
  provider-side endpoints still need confirmation against a real integration.

## DEFERRED IN THE PRE-LAUNCH SECURITY SWEEP (2026-09-27 — reviewed, consciously not changed)

A full security sweep ran before launch. What shipped in the sweep itself:
failure-only rate limiting on sign-in/sign-up (`peekRateLimit` + `AUTH_LIMIT`,
keyed by IP + email so routine sign-ins are never throttled), per-user budgets
on bid/list/report actions (`BID_LIMIT`, `AUCTION_CREATE_LIMIT`,
`REPORT_LIMIT`), open-redirect validation of `redirectTo` inside the auth
server actions via the shared `src/lib/safe-next.ts`, `imageUrlFor()` refusing
anything that is not a bare storage key, and the realtime header comment
corrected (channels are public; consumption is notification-only — see below).
The following were reviewed and deliberately left alone; each needs care the
pre-launch window did not have, and none is a known path to money or data loss:

- **Realtime channel authorization.** `auction:{id}` / `user:{id}` Broadcast
  channels are created without `private: true` and no `realtime.messages` RLS
  policies exist, so anyone holding the publishable key can subscribe to or
  post on them. Safe today only because every consumer treats events as a
  hint to re-read server state — no price, state, authorization or payment
  decision is derived from a payload (documented at the top of
  `src/lib/realtime/supabase.ts`). Closing it means Supabase private channels
  + `realtime.messages` policies; it must be verified against live bidding
  before it ships, so it was not risked pre-launch.
- **`is_banned` enforcement.** The column and RLS references exist, but no
  code path sets it (no admin surface does) and no action reads it. Wiring
  enforcement before an admin tool can set it would be theatre; build the
  admin operation first.
- **`profiles_insert_self` INSERT policy** has no `is_admin = false` guard, so
  a self-inserted row could claim admin. Profiles are actually created by the
  `handle_new_user` trigger on signup and the app never INSERTs `profiles` from
  the client, so the only way in is a manually inserted row for a missing
  profile id. One-line `with check` tightening when migrations are next open.
- **`auction_images.storage_path` has no DB format CHECK.** The server action
  validates uploads and `imageUrlFor()` now refuses non-key values, but a
  direct PostgREST write can still store an odd string. A CHECK constraint is
  a follow-up migration.
- **Bid idempotency scope** is `(bidder_id, request_id)` — a request id reused
  across two different auctions would resolve to the earlier bid. Clients
  generate a fresh UUID per submit, so the collision is theoretical; scope the
  key by auction id when the engine next changes.
- **Anti-snipe `extension_count` is unbounded** — a determined bidder could
  extend an auction repeatedly. A cap (e.g. max extensions per auction) is a
  product rule that needs its own test; not added in the sweep.
- **Admin raw error text** — the admin-only surface returns the provider's raw
  `error.message` for operator diagnostics. Deliberate for now; genericize if
  an admin UI ever becomes multi-user.
- **`scripts/db/verify-engine.mjs` test credentials** — a local database
  verification script carries its own test login. It is never deployed and
  never touches production data; keep it out of any hosted context.
- **Distributed rate limiting** — see *Infrastructure limits* above; the new
  budgets are in-memory per instance (sufficient on Hobby's single isolate,
  not a DDoS control).

Never add:
- fake counters
- fake reviews
- fake testimonials
- fake metrics
- fake payments
- fake activity
- vague hero statements
- purple gradients
- pill-button-heavy UI
- emoji UI where icons are available
- cursor-follow animations
- excessive scroll animations
- unnecessary navigation
- placeholder copy

Always check:
- favicon
- page title
- meta description
- custom 404
- footer links
- copyright year
- clickable logo
- clickable phone
- clickable email
- no horizontal/mobile overflow
- broken links/buttons
- image compression
- real success/error feedback

## REVIEW THIS AFTER FIRST REVENUE

When BidBlitz has real transactions/revenue, reassess:
- distributed rate limiting
- richer analytics
- fraud detection
- paid observability
- higher realtime limits
- automated payments/payouts
- professional seller tools
- AI-assisted pricing
- dealer/liquidation auctions
- mobile app
