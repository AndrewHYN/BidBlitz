# BidBlitz 3-Day Execution Plan

## Goal

Ship a deployable MVP that proves the live auction transaction loop, feels premium on mobile and desktop, and can be demonstrated by non-technical stakeholders.

## Day 1 — Foundation and marketplace shell

### Deliver
- Scaffold current stable Next.js App Router + TypeScript.
- Configure Tailwind v4 and shadcn/ui.
- Configure Supabase browser/server clients correctly for SSR.
- Add database migrations for profiles, categories, auctions, auction_images, bids, watchlist, notifications, transactions, fee_settings.
- Add RLS policies and indexes.
- Build responsive app shell, navigation, search, home, browse, category and auction-detail layouts.
- Build the seller creation flow with image upload, validation and preview.
- Add seed data for a realistic local demo.

### Checkpoint
Run lint, typecheck, unit/integration tests and production build. Inspect the UI in a real browser at desktop and mobile widths. Commit the milestone.

## Day 2 — Live auction engine

### Deliver
- Implement database-authoritative bid function/transaction.
- Implement idempotent bid submission.
- Implement server-side auction state transitions.
- Implement server-side anti-sniping extension.
- Implement realtime bid/state updates with a dedicated realtime adapter.
- Add live countdown synchronization based on server timestamps.
- Add outbid notifications and winner/auction-ended state.
- Add watchlist and ending-soon behavior.
- Add robust loading, error, offline/reconnect and empty states.

### Critical concurrency test
Simulate two or more simultaneous bids and prove the resulting ordering/current bid is deterministic and cannot corrupt auction state.

### Checkpoint
Run the critical auction test suite and browser E2E tests. Verify two browser sessions can bid against the same auction live. Commit the milestone.

## Day 3 — Monetization, trust, operations and launch quality

### Deliver
- Seller and buyer dashboards.
- Transaction/fee records and configurable platform fee.
- Featured-auction capability with a disabled/unavailable payment state until a provider is configured, rather than fake payments.
- Reputation foundations and completed-transaction reviews.
- Reports for auction/user.
- Lightweight admin/operator dashboard.
- Analytics event instrumentation.
- SEO metadata and Open Graph for public auction pages.
- Accessibility pass.
- Performance pass.
- Security/RLS pass.
- Production environment documentation.
- Vercel deployment configuration.

### Final acceptance
1. User A signs in.
2. User A creates and publishes an auction.
3. User B opens it.
4. User B bids.
5. User A sees the bid without refreshing.
6. User C bids and User B receives an outbid update.
7. Auction reaches its server-authoritative close time.
8. Winner is recorded exactly once.
9. Seller sees completed-sale state.
10. Fee record exists.
11. The same core journey works on a mobile viewport.

## Scope control

Do not add native apps, crypto wallets, full escrow, shipping integrations, direct messaging, AI pricing, loyalty programs, complex search infrastructure, or a social feed during this 3-day window.

## Product advantage to preserve

BidBlitz is about speed and competition, not a giant classifieds catalog. Every major screen should reinforce:

SELL QUICKLY
DISCOVER LIVE DEALS
SEE THE REAL-TIME PRICE
ACT NOW

## Quality bar

The app must not look like a generated dashboard template. Use a deliberate visual system, consistent spacing, responsive states, restrained motion, realistic data, strong typography, clear CTAs, and careful mobile interaction design.

Never hide a broken flow behind a mock button. Either make it work or clearly mark the capability as unavailable/configuration-required.
