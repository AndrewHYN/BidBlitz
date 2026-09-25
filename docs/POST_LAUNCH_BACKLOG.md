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

## PRODUCT REMINDERS

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
