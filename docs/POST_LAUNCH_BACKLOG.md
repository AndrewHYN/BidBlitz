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
Before enabling real buyer/seller money movement:
- choose a compliant payment provider available to the target market,
- implement server-verified checkout/payment status,
- implement payout/settlement rules,
- add webhook verification,
- add refunds/disputes as required,
- review legal/regulatory obligations.

### Future monetization
Potential post-launch revenue:
- successful-sale platform fee
- featured auction/boost
- professional seller/dealer accounts
- analytics tools
- promoted listings
- transaction/payment services

Do not build these prematurely if they slow down proving the marketplace.

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
