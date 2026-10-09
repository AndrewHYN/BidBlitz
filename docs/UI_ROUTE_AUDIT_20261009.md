# BidBlitz UI and route audit — 9 October 2026

## Scope and evidence

All 39 page route definitions were inspected for metadata, headings, route links, access boundaries and shared layout usage. Literal internal links across TSX sources resolved to existing routes. All 39 representative URLs were fetched read-only; streamed HTTP 200 responses on protected routes were then checked in the browser, where all 21 correctly reached sign-in. No protected content was inferred from an HTTP status alone.

Desktop browser checks covered the public static pages and a real live auction. Account, seller and staff content behind authentication has source review and signed-out gate verification, not a completed authenticated visual audit. Dynamic detail pages use nonexistent IDs for anonymous gate checks; no test transaction was created.

## Fixed findings

- Login, signup, forgot-password and reset-password now use one shared responsive split layout, with one page-level heading, a clickable brand and compact mobile form. Removed the legacy auth shell and nested form cards.
- Signup no longer repeats seller onboarding twice. One expandable SmileCash guide explains the listing requirement, the USSD registration code, fees and buyer exemption.
- Google is outlined; the main email form submission retains the orange primary action. Password, Google, OTP, errors, confirmation and reset logic are preserved.
- Profile and storefront metadata now falls back when optional text is empty or whitespace. Team invitation has its own description.
- Shared page/section headings wrap their actions. User-entered profile and storefront text has word wrapping; finance grid columns have explicit zero minimums.
- Browse and business settings copy describes user tasks instead of URL mechanics and unimplemented enterprise features.
- Missing business storefront returned HTTP 200 before this pass. Proxy now mirrors the ACTIVE storefront query using the same public client/RLS and returns an actual noindexed 404 before streaming. Existing stores still render; database errors are not treated as proof of absence.

## Release checks

- 602 tests passed across 54 files, including 7 request-level resource-routing tests.
- ESLint, TypeScript, optimized Next production build and git whitespace check passed.
- Release smoke coverage now includes reset-password, staff/team routes, private detail guards and missing storefronts.
- Fresh Playwright desktop/mobile execution is blocked: browser executable is absent and its download returned empty/truncated archives. No fresh Playwright pass is claimed.
- Production desktop follow-up checks must verify the released auth pages and the storefront 404. Authenticated visual QA needs a signed-in account with suitable staff access.

## Route coverage

| Route | Coverage at pre-deployment checkpoint |
| --- | --- |
| `/about` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/admin/disputes/[id]` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/admin/disputes` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/admin/finance` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/admin/guide` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/admin` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/admin/team/accept` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/admin/team` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/auction/[id]` | Source, real live auction desktop; missing resource HTTP 404 |
| `/auth/callback` | Source and HTTP; credential-free callback follow-up only, no real auth token used |
| `/browse` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/business/[slug]` | Source, HTTP 200 defect fixed with request tests; post-deploy 404 recheck |
| `/dashboard/buying` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/dashboard/disputes/[id]` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/dashboard/disputes` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/dashboard` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/dashboard/selling` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/dashboard/transactions/[id]` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/dashboard/transactions` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/dashboard/watchlist` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/faq` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/forgot-password` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/help/fees` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/help` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/help/rules` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/how-it-works` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/login` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/notifications` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/privacy` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/profile/[username]` | Source, missing resource HTTP 404; public seller profile follow-up |
| `/reset-password` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/sell/[id]` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/sell` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/settings/business` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/settings` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/settings/payouts` | Source, read-only HTTP and anonymous browser sign-in gate; authenticated visual QA pending |
| `/signup` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |
| `/terms` | Source, read-only HTTP, desktop browser; changed screens require post-deploy recheck |

## Money controls

Read-only Supabase verification: `payments_enabled=false`; `auction_require_payout_ready`, `seller_payout_block_unresolved_dispute` and `seller_payouts_protect_state` remain enabled. No migration, wallet change, payment, payout or provider key change was performed. Provider authentication remains a separate unresolved launch blocker.
