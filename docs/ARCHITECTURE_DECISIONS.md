# BidBlitz Architecture Decision Record

Date: 2026-09-24

## ADR-001: Framework — Next.js App Router (16.x)

Status: Accepted

### Context

The repo allowed any current stable meta-framework. Candidates evaluated were
Next.js App Router, TanStack Start, React Router Framework Mode and SvelteKit.

### Decision

Use **Next.js App Router** as the single primary application framework.

### Why

- The product loop is server-authoritative (bids, auction state, fees). Next.js
  Server Actions + Server Components give a direct, typed path from browser to
  server logic without inventing a second API layer.
- Server-rendered public auction pages give real SEO/OG/social previews for free,
  which the spec requires for shareable auction links.
- Deployment target is Vercel, where Next.js has first-class support, so the
  deployment constraint costs nothing.
- Largest ecosystem surface for Supabase SSR auth, shadcn/ui and Playwright.

### Rejected

- **TanStack Start**: excellent type-safety story, but a younger deployment and
  caching model on Vercel. Inside a three-day window the risk of fighting the
  framework outweighs the ergonomic gains. Not installed.
- **TanStack Router alongside Next**: explicitly rejected. Two routers in one
  runtime is incoherent. Next.js routing is the only router.
- **SvelteKit / Nuxt / React Router**: no material advantage for a
  server-authoritative realtime marketplace that must ship in three days.

### Consequences

- Server Actions are the application's domain boundary (`src/server/*`).
- All financial and auction-state logic lives server-side, never in the browser.

---

## ADR-002: Data — Supabase Postgres, Auth, Storage, Realtime

Status: Accepted

- PostgreSQL via Supabase (managed). Schema in `supabase/migrations/*.sql`.
- Auth via Supabase Auth (email/password) with SSR cookie session handling.
- Images via Supabase Storage, private bucket + signed/public serving with
  server-side validation (type, size, count).
- Realtime via an isolated adapter (`src/lib/realtime/*`) so the transport can be
  swapped without touching auction domain code.

### Key model

Current Supabase key model only:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) on the client.
- `SUPABASE_SECRET_KEY` (`sb_secret_...`) server-only.

Legacy `anon` / `service_role` JWTs are **not** used — Supabase deprecates them
by end of 2026.

---

## ADR-003: Money — integer minor units only

Status: Accepted

- Every monetary value is an integer in minor units plus an explicit `currency`.
- Example: `$399.00` is stored as `amount_minor = 39900`, `currency = 'USD'`.
- Platform fees are computed inside SQL/PLPGSQL server-side and the *result* is
  persisted on the transaction row. The client never computes a fee, a total, or
  a winner.

---

## ADR-004: Concurrency — database-level serialization

Status: Accepted

Bidding is serialized in Postgres, not in JavaScript:

- `place_bid()` PLPGSQL function running in a single transaction.
- Row lock on the auction (`SELECT ... FOR UPDATE`) before validating state,
  end time and minimum increment.
- Idempotency key (`request_id uuid`) with a unique index so a replayed request
  returns the original result instead of creating a second bid.
- Anti-sniping extension mutates `ends_at` inside the same locked transaction,
  then emits `auction.extended`.

Rationale: JS-level locks or `async/await` mutual exclusion cannot survive
multiple server instances, process restarts or reconnect retries. The database
is the only trustworthy serializer.

---

## ADR-005: Realtime is transport, never authority

Status: Accepted

Correct order of operations for every bid:

```
client -> server action -> DB transaction commits -> realtime event emitted -> clients update
```

The browser never predicts a win, a price or an auction end. Countdown is
rendered from server timestamps plus a synchronized clock offset
(`src/lib/clock.ts`), so local clock manipulation cannot affect validity.

---

## ADR-006: Payments — provider abstraction, no fake checkout

Status: Accepted (extended by **ADR-011**, which records the Paynow research
and the code written behind this seam)

`src/server/payments/*` defines a `PaymentProvider` interface. No provider is
configured in the MVP, so the UI shows an explicit **configuration-required**
state. The platform still records the sale, the fee and the seller proceeds as
an *unpaid* transaction.

The words "Payment successful" are never rendered unless a real provider
confirms the charge.

---

## ADR-007: Not adopted (deliberately)

| Tool | Decision | Reason |
| --- | --- | --- |
| TanStack Router/Start | Not installed | Would create a second router (see ADR-001) |
| Temporal | Not installed | No long-running durable workflow in the MVP |
| Cloudflare Workers | Not installed | No edge workload that measurably helps yet |
| FastAPI / Python | Not installed | TypeScript server actions cover the domain |
| Elasticsearch/Algolia | Not installed | Postgres FTS is sufficient at this scale |
| Pydantic | Not installed | No Python service exists |
| tldraw/Excalidraw | Not a runtime dep | Diagrams documented here as text |

---

## ADR-008: Settlement triggers — never one path

Status: Accepted

### Context

An auction must reach its terminal state (`SOLD` / `UNSOLD`) exactly once, with
a deterministic winner and exact fee math. A single trigger — a cron job, a page
view, a bid — is a single point of failure: if it does not fire, the row stays
`LIVE` after `ends_at` and the UI starts telling two different stories (badge
says Live, countdown says 00:00:00).

### Decision

**Correctness lives in Postgres. Promptness comes from three redundant
triggers.**

1. **Bid path (hard, non-bypassable).** `place_bid()` sees `status = LIVE` with
   `ends_at <= clock_timestamp()`, settles that auction, then refuses the late
   bid. Cannot be skipped — it executes inside the only bid writer.
2. **Read path (throttled reconcile-on-read).** `sweepDueAuctions()` in
   `src/server/sweep.ts` is called by the home feed and browse read model. At
   most once per instance per 60s, it invokes `settle_due_auctions()`. It never
   throws, never runs during `next build`, and performs no auction logic itself.
3. **Schedule.** `GET /api/cron/settle` runs `settle_due_auctions()` and then
   announces `auction.ended` on each auction's realtime channel.

`settle_auction()` is idempotent and `settle_due_auctions()` takes
`FOR UPDATE SKIP LOCKED`, so all three may run concurrently against the same row
without double-settling.

### Consequences

- No auction can be permanently stuck in `LIVE`; at worst a badge is stale for
  one read.
- The realtime announcement is emitted **after** the commit and is best-effort.
  A dropped event changes no state — every page re-reads Postgres on its next
  request.

### Deployment constraint (deliberate)

`vercel.json` schedules `/api/cron/settle` for `0 4 * * *` (daily). Vercel
**fails the deployment** when a Hobby-plan project's cron expression runs more
than once per day, so a minute-level schedule would make the project
undeployable on the free tier. Because triggers (1) and (2) are what actually
keep the tables correct, cron is a *convenience*, not a dependency. On a paid
plan, change the one line to `* * * * *` for sub-minute freshness — nothing else
needs to change.

### Auth

The cron route requires `Authorization: Bearer ${CRON_SECRET}` and refuses
*everything* when `CRON_SECRET` is unset, rather than accepting
`Bearer undefined`. Comparison is length-checked and XOR-based so the secret is
not leaked through response timing.

---

## ADR-009: Session refresh lives in `src/proxy.ts`, authorization does not

Status: Accepted

### Context

Next 16 renamed the `middleware` convention to `proxy`. `src/lib/supabase/server.ts`
cannot persist rotated auth cookies during a Server Component render — the write
is caught and deliberately ignored — and its comment assumed a middleware would
handle refresh. No such file existed, so once a session crossed its expiry
boundary, every subsequent request would refresh against GoTrue and then throw
the rotated token away: one round trip per page view, indefinitely.

### Decision

`src/proxy.ts` refreshes cookies and does nothing else.

- **It uses `getSession()`, not `getUser()`.** Verified against
  `@supabase/auth-js`: `getUser()` always issues `GET /user`, while
  `getSession()` reads cookies locally and only calls GoTrue inside the 90s
  expiry margin. A proxy on *every* request calling `getUser()` would double
  the Auth traffic that `SiteHeader` already generates for a valid session and
  cost ~zero benefit.
- **It performs no authorization.** Server actions verify with `getUser()`
  (server-side token validation) and every protected page gates itself. This is
  deliberate: Next's data-security guidance notes that server function calls
  share their page's path, so a route can be unprotected the moment a matcher
  or a refactor changes. The matcher is an optimization, never a control.
- **It never redirects.** Redirects are owned by the pages (with their
  `?next=` handling), so there is exactly one layer deciding where an
  unauthenticated user goes.

### Consequences

- Refreshed sessions are actually persisted; the "refresh on every request
  forever" failure mode is gone.
- Anonymous traffic pays no measurable cost: no config → pass through; valid
  session → no network call at all.

## ADR-010: Launch security hardening — `private` schema, `search_path = ''`, advisor dispositions

Status: Accepted

### Context

The final pre-launch advisor pass (`GET /v1/projects/{ref}/advisors/security`
and `/advisors/performance`) reported 23 security and 38 performance findings.
The substantive ones: SECURITY DEFINER helpers executable by `anon` through
`/rest/v1/rpc`, four functions with no fixed `search_path`, `pg_trgm` installed
in `public`, 15 RLS policies re-evaluating `auth.uid()` per row, four unindexed
foreign keys, five actions carrying two permissive policies each, and one pair
of identical indexes.

### Decision

1. **A `private` schema that PostgREST does not expose.** Policy helpers
   (`is_admin`, `is_seller_of`, `can_view_auction`) and trigger functions
   (`handle_new_user`, `sync_email_verified`, `sync_image_count`,
   `touch_updated_at`, `auctions_protect_state`) moved there with
   `ALTER FUNCTION ... SET SCHEMA`, which preserves object OIDs — so every
   trigger and policy that captured them keeps working. RLS predicates resolve
   functions by OID; `/rest/v1/rpc/*` routes only `public`, so the functions
   vanish from the API surface (verified: `rpc/is_admin` → `404 PGRST202`).
   `anon`/`authenticated` keep `EXECUTE` on the two helpers their own policies
   evaluate (`is_admin`, `can_view_auction`), which is unreachable via
   PostgREST anyway; `is_seller_of` is authenticated-only.

2. **`SET search_path = ''` on every function we own**, with schema-qualified
   references (`public.*`, `private.*`, `auth.uid()`, `public.auction_status_t`
   casts). A SECURITY DEFINER function on a mutable search_path resolves
   objects against whatever the calling role can create first; `''` removes
   that attack class. Migration 000010 ends with a guard that raises if any
   function in `public`/`private` still lacks a fixed `search_path`.

3. **App change, not just SQL.** The admin UI called `supabase.rpc("is_admin")`.
   With the function moved, both call sites read `profiles.is_admin` on the
   caller's own row — the same fact, through normal row policies — and the
   stale entry was removed from `src/lib/supabase/types.ts`.

4. **The sweep is service_role-only.** `settle_due_auctions` is invoked
   exclusively by admin-key paths (`src/server/sweep.ts`, `/api/cron/settle`),
   so its `authenticated` EXECUTE grant was revoked. The per-auction
   `settle_auction()` the seller UI calls keeps its authenticated grant.

5. **`pg_trgm` moved to `extensions`.** The GIN index on `auctions.title`
   references its operator class by OID and is unaffected; no query calls
   `similarity()`/`show_trgm()` (search runs on `search_vector` + `ilike`).

6. **RLS performance, semantics untouched.** Every `auth.uid()` in policies
   became `(select auth.uid())` — evaluated once per statement; `auth.uid()`
   cannot change within a statement. `auctions_admin` and
   `profiles_admin_update` merged into their base policies as an
   `OR private.is_admin()` arm: the permissive union is identical, admin
   authority is preserved (harness: "admin CAN triage a report"), and
   `multiple_permissive_policies` drops to zero.

7. **Four covering indexes** for the unindexed FKs (`auctions.current_bidder_id`,
   `auctions.winner_id`, `notifications.auction_id`, `reviews.reviewer_id` —
   each a real dashboard/detail access path) and the duplicate
   `auctions_ending_soon_idx` dropped (identical to `auctions_live_ends_idx`).

### Advisor dispositions (re-measured after apply)

- **Security: 23 → 5**, every remaining item reviewed:
  - 4 × `authenticated_security_definer_function_executable` for
    `place_bid`, `publish_auction`, `cancel_auction`, `settle_auction` —
    this *is* the product's RPC surface. Each function re-checks identity,
    ownership and state before acting and all four are proven by the
    57-check engine harness; revoking would delete bidding itself.
  - 1 × `auth_leaked_password_protection` — GoTrue answers HTTP 402:
    HaveIBeenPwned checks are gated to Pro plans and up. Documented as a
    manual action in the final report.
- **Performance: 38 → 15**, all `unused_index` INFO. The four new FK indexes
  read zero on an idle database; they index real query shapes (buyer
  "winning" dashboard, winner page, per-auction notifications, "my reviews").
  No HIGH findings; `auth_rls_initplan`, `unindexed_foreign_keys`,
  `multiple_permissive_policies` and `duplicate_index` are all zero.

### Consequences

- `anon` can no longer invoke any SECURITY DEFINER function through the API;
  internal functions have no API route at all.
- Fresh databases and the live project converge: 000010 is guarded and
  idempotent (`to_regprocedure` checks, `if exists`, extension-schema probe),
  and the harness rebuilds from all ten migrations green (57/57).
- The `private` schema must stay out of PostgREST's exposed-schema setting;
  if it were ever added, `anon_security_definer_*` findings would return.

---

## ADR-011: Payment provider — Paynow researched and built behind the seam, not activated

Status: Research complete, implementation behind the seam, **not activated**
Date: 2026-09-26

Everything below was read from Paynow's *current* official documentation — the
Developer Hub (`developers.paynow.co.zw`) and the merchant site
(`paynow.co.zw`) — on the date above. Nothing is taken from an old blog post,
a copied integration guide, or an SDK README. Where the official documentation
is ambiguous or silent, it is listed under **Open questions** rather than
resolved by guessing.

### Context

Phase 2 left the full commercial loop *recorded* but not *paid*:
`SELL → BID → WIN → TRANSACTION (AWAITING_PAYMENT) → FEE → PROCEEDS`. The
remaining gap was whether a real rail could be attached without rewriting the
auction engine, without faking a checkout, and without a paid infrastructure
subscription.

### Decision

**Keep `PaymentProvider` as the only seam, implement Paynow behind it, and
leave it switched off until a test-mode integration has been verified end to
end.**

| | |
| --- | --- |
| Provider abstraction | `src/server/payments/provider.ts` (interface, error vocabulary, registry) |
| Credential selection | `src/server/payments/config.ts` — the **only** module that knows which provider is in use |
| Paynow implementation | `src/server/payments/paynow.ts` |
| Database writes | `src/server/payments/ledger.ts` → `mark_transaction_paid` / `mark_transaction_failed` / `mark_transaction_refunded` / `record_payment_event` |
| Webhook | `POST /api/payments/webhook` |
| Checkout | `POST /api/payments/checkout` |
| Registration state today | `NoopPaymentProvider` — `PAYNOW_*` variables are absent, so nothing is configured |

### Paynow — verified capability summary

**Provider.** Paynow is operated in Zimbabwe by Integrated Payments Services
(Pvt) Ltd (`paynow.co.zw`), with a separate Developer Hub at
`developers.paynow.co.zw`.

**Onboarding (merchant side).** Per the official integration documentation,
getting credentials means:

1. Register at `paynow.co.zw/Customer/Register` and complete email validation.
2. Log in and register the **settle account** — the Zimbabwean bank account
   funds are paid into. Paynow states no separate merchant account and no bank
   paperwork are required.
3. Go to *Other Ways To Get Paid* → *Create/Manage Shopping Carts* →
   *Create Advanced Integration*: name it, choose whether the merchant absorbs
   fees, give a notification email, pick the payment methods, save.
4. The **Integration ID** is shown; the **Integration Key** is *not* displayed
   and must be requested via *Email Key To Company Address*. It must be kept
   secret.
5. A newly created integration is usable **in test mode** immediately.
   *Generate New Key* when moving from development to live, which also
   invalidates any key other developers held.

**KYC / "Verified Merchant"** is a separate, document-based process
(`verify.paynow.co.zw`): company letterhead letter confirming bank details,
director ID, proof of account in the company's name, logo; plus CR2, MAA, CR6
and related documents for full verification. This governs settlement
limits/behaviour, not the ability to open a test integration.

**Payment methods.** The current documented set: Visa, Mastercard, Zimswitch,
Vpayments, EcoCash, OneMoney, Telecash, and (in Express Checkout) InnBucks and
O'mari. Express Checkout captures payment method details inside the merchant's
own app with no redirect, at `POST /interface/remotetransaction`.

**Initiation / redirect flow.** `POST
https://www.paynow.co.zw/interface/initiatetransaction` as
`application/x-www-form-urlencoded` with `id`, `reference`, `amount`, `returnurl`,
`resulturl`, `status` and `hash`. The reply is a form message carrying
`status`, `browserurl` (where the buyer is sent), `pollurl`, `paynowreference`
and `hash`. The buyer pays on Paynow's hosted page and returns to `returnurl`.

**Callback.** Paynow POSTs a form message to `resulturl` — our
`/api/payments/webhook` — with `reference`, `amount`, `paynowreference`,
`status`, `pollurl` and `hash`. Paynow does **not** expect a body; if the
response is an HTTP error status it resends **up to ten times** before
desisting. Polling `pollurl` is documented for confirming current status.

**Hash / signature.** SHA-512, uppercase hex: concatenate the message values
(URL-decoded, `hash` excluded) in message order, append the Integration Key,
hash. Paynow publishes worked examples, and **both are asserted byte-for-byte
in `paynow.test.ts`** using Paynow's own published example key
(`3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977`). There is no nonce, timestamp or
timestamp window in the scheme.

**Status vocabulary.** `Paid`, `Awaiting Delivery`, `Delivered` (money good);
`Created`, `Sent` (in flight); `Cancelled` (failed); `Disputed` (held);
`Refunded` (returned); plus `NotFound` when polling an unknown reference.

**Refunds.** The published reversal endpoint is part of **BillPay**, and its
own documentation states "a very limited set of billers accept reversals/refunds.
Most do not." No general-purpose refund endpoint for an advanced-integration
merchant is documented. This is an open question (below).

**Merchant charges.** Published fee table: Visa/Mastercard 3.5% + $0.50,
Vpayments 1% + $0.50, EcoCash/OneMoney/Telecash 2.5%. No signup or usage fee —
per-transaction commission only. The merchant chooses whether to absorb, pass
on, or split the fee.

**Settlement / payouts.** Paynow settles to the registered Zimbabwean bank
account, less fees: locally switched payments (EcoCash, TeleCash, OneMoney,
Vpayments) next day, local Visa/Mastercard T+2, foreign Visa/Mastercard T+3,
20:00 cut-off; non-verified merchant accounts settle once weekly on a
Tuesday. **There is no seller-facing payout API**: money reaches the
*platform's* bank account, and any onward payment to a seller is a separate
problem (see `docs/POST_LAUNCH_BACKLOG.md`).

**Marketplace / split payments — NOT available.** A web search for "Paynow
marketplace" surfaces `docs.paynow.pl`, which is **Paynow Poland (ING)**, a
different company in a different country with a `transfers[]` split-payment
API. Paynow Zimbabwe publishes no such API. BidBlitz therefore does **not**
claim escrow, split payments or sub-merchant payouts.

**Production activation.** Integration starts in test mode; the merchant
requests "Set Live" in the Paynow dashboard once testing passes, and generates
a fresh key at that point.

**Stripe — country availability, stated factually.** Stripe is not a viable
target for this launch: Stripe's supported-country list does not include
Zimbabwe for a Zimbabwean merchant account (settlement, card acquiring and
onboarding are unavailable there). Stripe is therefore recorded as *not
selected*, not *deferred* — the constraint is geographic, not technical. It is
not a hard dependency anywhere in the codebase and no Stripe package is
installed.

### What was built (and what it does not do)

- **Webhook security.** Raw body is passed through untouched to `confirm()`
  for hashing; signature is verified *before* any field is believed; amount,
  currency and reference are re-checked in Postgres by
  `mark_transaction_paid()`; `(provider, event_id)` dedupe makes redelivery a
  no-op; `AWAITING_PAYMENT → PAID` is the only path in, and a redirect from
  the provider's page can never reach it.
- **State machine.** `AWAITING_PAYMENT → PAID | FAILED`, `PAID → SETTLED |
  REFUNDED` — each with its own row-locked, event-deduplicated,
  service-role-only writer, all verified by the engine harness.
- **Checkout.** `POST /api/payments/checkout` starts an intent for the
  *buyer of record* only, reads the price from the row (never from the
  request), and returns a payment page. It has **no write path** to
  `transactions`. It answers `503 no_payment_provider` today, and the UI does
  not render a pay button while that is true.
- **No payout code.** Nothing moves money to a seller.

### Verified capability list

| Capability | Status | Evidence |
| --- | --- | --- |
| Hosted checkout with redirect | Documented | `initiatetransaction` + `browserurl` |
| Server-to-server callback | Documented | `resulturl` POST, up to 10 retries |
| Signature verification | **Verified in tests** | both official hash vectors asserted in `paynow.test.ts` |
| Amount + currency verification | **Verified in DB** | harness: wrong amount, wrong currency rejected, nothing written |
| Unknown transaction rejected | **Verified in DB** | harness: `transaction_not_found` |
| Duplicate / replayed event | **Verified in DB** | harness: `already_paid`, `already_failed`, `already_refunded`, one audit row each |
| Failed payment handling | **Verified in DB** | harness: `AWAITING_PAYMENT → FAILED` |
| Refund state transition | **Verified in DB** | harness: `PAID → REFUNDED` |
| Sandbox / test mode | Documented | integration starts in test mode; **not yet exercised** |
| Server-initiated cancellation | **Not available** | no documented endpoint — `cancel()` refuses rather than no-ops |
| Escrow / split payment to sellers | **Not available (Zimbabwe)** | only Paynow Poland publishes `transfers[]` |
| End-to-end sandbox transaction | **NOT DONE** | requires a Paynow account — see below |

### Open questions (unresolved, deliberately)

1. **Hash concatenation on inbound messages.** The *Generating Hash* page says
   concatenate the values only; a separate page about the Custom Button
   Template says concatenate *key plus value*. Our implementation follows the
   primary page plus its worked examples (which reproduce exactly). This must
   be confirmed against a real test-mode callback.
2. **Whitespace in values.** Paynow's published outbound example contains a
   leading space in `returnurl= http://...` yet publishes a hash that only
   reproduces when the value is trimmed; we trim. To be re-confirmed live.
3. **Paynow reference uniqueness per merchant reference.** Our `reference` is
   the transaction UUID. Nothing documents what Paynow does if the same
   reference is initiated twice (a buyer tapping *Pay now* twice). Because the
   database allows only `AWAITING_PAYMENT → PAID` once, this cannot corrupt
   state — but the intent record to correlate a `pollurl` is **not persisted**,
   and is deliberately deferred until a real callback can be measured against.
4. **Refunds.** Endpoint availability for an advanced-integration merchant is
   unconfirmed; `PAID → REFUNDED` is implemented and tested, but how Paynow
   reports a refund to *this* kind of merchant must be confirmed in test mode.
5. **Disputes.** `Disputed` is recorded in the audit log and changes no state;
   no dispute-resolution flow exists.

### The exact manual step still required

Create a Paynow merchant account, register a settle account, create an
Advanced Integration (test mode), and obtain the Integration ID and Key. Then
set `PAYNOW_INTEGRATION_ID` and `PAYNOW_INTEGRATION_KEY` in Vercel and run the
full proof list (initiation, redirect, callback, signature verification,
success, failure, cancel, duplicate callback, wrong amount, wrong currency,
unknown transaction, replayed event) in test mode before requesting "Set Live".
Until that is done, **payment is not "working"** — only ready to be tested.
