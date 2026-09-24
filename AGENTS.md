# BidBlitz Engineering Rules

BidBlitz is a fast, real-time marketplace for selling items through competitive live bidding.

## Core goal

"List it. Start the blitz. Get your price."

Three-day MVP must prove this loop:
Seller creates auction -> auction goes live -> buyers discover it -> buyers place valid bids -> realtime updates -> auction closes authoritatively -> winner is recorded -> seller sees sale -> platform fee is calculated.

## Non-negotiable engineering rules

- Database/server is authoritative for bids, auction state, time, permissions, winners, and fees.
- Bid submission must be safe under concurrent requests.
- Never use floating point for money; store integer minor units plus currency.
- Use UTC timestamps in storage.
- Sellers cannot bid on their own auctions.
- Closed auctions cannot accept bids.
- Prevent duplicate/replayed bid submissions.
- Anti-sniping extension is server-side.
- Validate all user input.
- Use Supabase Row Level Security for exposed tables.
- Never expose a service-role key to the browser.
- Handle reconnects, refreshes, slow networks, and duplicate realtime events.
- Mobile-first, keyboard accessible, and fast.
- Never present an unconfirmed bid as successful.
- Loading, empty, offline/reconnecting, success, and error states are first-class UI.

## Preferred stack

Use current stable releases that fit the MVP:
Next.js App Router, TypeScript, Tailwind CSS v4, shadcn/ui, Supabase Postgres/Auth/Storage/Realtime, Zod, Playwright, Vitest (or equivalent), Vercel.

Prefer a database-authoritative realtime design. Supabase Broadcast is the preferred scalable direction; isolate the realtime adapter so it can change later.

## UX

Make the next action obvious. Buyers should reach Bid quickly. Sellers should reach Start Auction quickly. Avoid huge forms and crowded pages. Current bid, time remaining, and primary action must dominate auction pages. Touch first, then desktop. Animations should be restrained and purposeful.

## Done means

Feature works end-to-end, tests pass, lint/typecheck/build pass, real-browser mobile/desktop verification passes, auth/RLS is checked, no secrets are committed, documentation is updated, and the milestone is committed cleanly.

## Git discipline

After each meaningful milestone: test -> lint/typecheck -> build -> inspect diff -> commit -> report SHA. Never rewrite user history unless required.
