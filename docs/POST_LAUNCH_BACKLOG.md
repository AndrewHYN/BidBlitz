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

### Payments
MVP deliberately does not fake payment.

Phase 3 moved this from "unimplemented" to "researched, built behind a seam,
and switched off" (see **ADR-011**). Completed: provider abstraction
(`PaymentProvider` with Noop/Paynow implementations), webhook signature
verification over the raw body, amount/currency/reference re-checks, event
dedupe and replay protection, the allowlisted state machine with
service-role-only writers, and a buyer checkout route. Not completed — and
therefore **not claimed**:

- **End-to-end sandbox verification.** Requires a Paynow merchant account, a
  registered settle account, an Advanced Integration, and the emailed
  Integration Key. This is the single manual onboarding step still outstanding.
- **Refunds as a real operation.** `PAID → REFUNDED` exists, is tested and is
  reachable only by service role, but Paynow's published reversal endpoint is
  BillPay-only and "a very limited set of billers accept reversals". The
  endpoint for an advanced-integration merchant must be confirmed in test mode.
- **Dispute handling.** `Disputed` is recorded in the payment audit log and
  changes no state. No flow exists beyond that.
- **Intent (`pollurl`) persistence.** Deliberately not added: no schema change
  without a real callback to measure it against.
- **Cancellation.** Paynow publishes no server-initiated cancellation
  endpoint, so `cancel()` refuses rather than pretending.

Before enabling real buyer/seller money movement:
- complete the test-mode proof list in ADR-011 before requesting "Set Live",
- implement payout/settlement rules (none exist; see *Payouts* below),
- add refunds/disputes once confirmed against the real API,
- review legal/regulatory obligations.

### Payouts (money path, stated plainly)
Today the money path is: **buyer → Paynow → the platform's registered
Zimbabwean bank account**, less Paynow's transaction fee. BidBlitz records a
5% platform fee and the seller's proceeds in integer minor units, but **nothing
transfers to a seller**. There is no seller payout API in Paynow Zimbabwe, no
escrow, and no split-payment support — the `transfers[]` split API belongs to
Paynow *Poland* (ING), a different company. Any onward payment to a seller is a
separate, manual administrative process (currently: platform-side bank
transfer), and must not be described as an automated payout.

### Future monetization
Potential post-launch revenue:
- successful-sale platform fee
- featured auction/boost
- professional seller/dealer accounts
- analytics tools
- promoted listings
- transaction/payment services

Do not build these prematurely if they slow down proving the marketplace.

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

- **Paynow test-mode verification** — the only step that can call payment
  "working". Needs a merchant account, a registered settle account, an
  Advanced Integration and the emailed Integration Key; then the full proof
  list in ADR-011. Until then `PAYNOW_*` stays unset in Vercel.
- **Custom domain** — production is `https://bid-blitz-ten.vercel.app`.
  Registering a domain is a deliberate, paid, human decision and is recorded
  here so it is not forgotten; do not purchase one as part of engineering work.
  When it happens: point the domain, update `NEXT_PUBLIC_SITE_URL` (which also
  rewrites the Paynow `resulturl`/`returnurl`), and re-run the canonical-URL
  smoke check.
- **Seller payout automation** — see *Payouts* above. No API exists in the
  chosen market; payouts stay manual and platform-administered.
- **Intent (`pollurl`) persistence** — deferred until a real callback shows
  what needs correlating.
- **Dispute and refund operations** — the states and writers exist; the
  provider-side endpoints still need confirmation against a real integration.

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
