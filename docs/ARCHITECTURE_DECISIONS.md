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

### An event is a hint, and now a bounded one (2026-09-28)

"Never authority" was the rule, but the implementation had a gap that a
2026-09-28 audit found by reading the code rather than the comment.

`auction:{id}` and `user:{id}` are **public** Broadcast channels, so an event
payload is attacker-controlled input for anyone holding the publishable key.
The detail page renders the *newest* of three server-delivered sources, and the
comparison was made on each source's `serverTime`. Two forgeries therefore beat
the server-rendered snapshot:

- an event with **no** `serverTime`, which fell back to the client mount time
  and so always looked newer than the server's own value;
- an event claiming a timestamp **years in the future**.

Either one overwrote the mirrored status, price and bid count in every other
viewer's browser, and because the mirrored `status` is what `<BidPanel>` renders,
a live auction could be made to look *ended* — removing the bid form for every
viewer until they reloaded. That is a denial of service against the
marketplace, and it needed no account.

**Decision: an event only reaches the mirror if it carries a timestamp within
`MAX_EVENT_FUTURE_SKEW_MS` of the newest timestamp the server has already
confirmed.** Every genuine publisher sets a real `serverTime`
(`place_bid`, `settle_auction`, `publish_auction`), so live bidding is
unaffected; the bound is enforced in `use-auction-realtime`, i.e. where the
event enters state, so a forged value is never rendered even briefly.

What this explicitly is **not**: an authorization boundary. The server remains
the only thing that decides whether a bid is valid, so a forged mirror cannot
make a bid succeed, move money, or change a transaction — it can only make one
browser briefly show a wrong public fact. The real fix is Supabase private
channels plus `realtime.messages` RLS policies, which must be verified against
live bidding before it ships; that stays on the backlog.

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

## ADR-011: Payment provider — Paynow researched, built behind the seam, then verified in test mode

Status: Accepted — **configured in production in Paynow test mode**, proof list
run 2026-09-26 (results in *Test-mode verification* below). One finding stands:
Paynow's status-update push never reached `resulturl`.
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
end.** *(Condition met 2026-09-26: the provider is on in Production in test
mode and the proof list ran — see Test-mode verification. Delivery of status
updates remains unproven and is tracked in the backlog.)*

| | |
| --- | --- |
| Provider abstraction | `src/server/payments/provider.ts` (interface, error vocabulary, registry) |
| Credential selection | `src/server/payments/config.ts` — the **only** module that knows which provider is in use |
| Paynow implementation | `src/server/payments/paynow.ts` |
| Database writes | `src/server/payments/ledger.ts` → `mark_transaction_paid` / `mark_transaction_failed` / `mark_transaction_refunded` / `record_payment_event` |
| Webhook | `POST /api/payments/webhook` |
| Checkout | `POST /api/payments/checkout` |
| Registration state today | `PaynowPaymentProvider` in Production — `PAYNOW_INTEGRATION_ID` / `PAYNOW_INTEGRATION_KEY` are Vercel **Production secrets** (set 2026-09-26). Elsewhere it is `NoopPaymentProvider`. |

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
desisting. Polling `pollurl` is documented for confirming current status, and
it answers with the *same* signed message shape; BidBlitz stores that URL at
initiation and uses it as the **fallback** (`POST /api/payments/reconcile`,
server-side only, explicit request) when no status update is delivered.
`resulturl` remains the primary signal.

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
  `transactions`. It answers `503 no_payment_provider` only while no provider
  is configured; in Production it answers `401 unauthenticated` without a
  session, `403 not_the_buyer` for anyone else, and returns a Paynow
  `redirectUrl` for the buyer of record while the row is still
  `AWAITING_PAYMENT`. The UI renders a pay button only while a provider is
  configured.
- **No automatic payout code.** Nothing moves money to a seller. What exists is
  the *record* of a manual payout — see **ADR-012**, which deliberately keeps
  payment status and payout status in separate tables so that a manual,
  human-executed transfer can never be mistaken for an automated split.
- **Reconciliation fallback (added 2026-09-27).** `resulturl` remains the
  **primary** settlement signal. What test mode proved is that a push can
  simply never arrive, so initiation now persists Paynow's `pollurl` in a new
  `payment_intents` table (RLS on, **no policies**, no PostgREST surface — the
  URL is a capability token) and `POST /api/payments/reconcile` lets a party to
  the transaction ask the server to check *that one* transaction. Server-side
  only and HTTPS to `*.paynow.co.zw` only: the reply is hash-verified before
  any field is believed, the `reference` must be this transaction, the `amount`
  must equal the sale re-read from Postgres, and the currency must be one
  Paynow settles. The result then passes through the same `ledger.ts` writers,
  so row locks, `(provider, event_id)` dedupe, idempotent transitions and
  "never downgrade `PAID`" hold unchanged — a replayed check writes nothing and
  `Cancelled` still lands on `FAILED`. The request body's only meaningful field
  is `transactionId`; a browser-supplied `status` is ignored outright. There is
  **no timer, cron or queue**: only explicit, rate-limited requests (per caller
  and per transaction), so it can never become an uncontrolled polling loop,
  and the answer it returns is re-read from Postgres after the provider ran.

### Verified capability list

| Capability | Status | Evidence |
| --- | --- | --- |
| Hosted checkout with redirect | Documented | `initiatetransaction` + `browserurl` |
| Server-to-server callback | **Push not observed** | `resulturl` documented as the target; across seven test transactions (eight initiations through 2026-09-27) **zero POSTs** reached production — see *Test-mode verification* and *Reconciliation proof* |
| Status by polling `pollurl` | **Verified live** | Paynow returns the same signed message shape (`reference`, `paynowreference`, `amount`, `status`, `pollurl`, `hash`); our verifier accepted Paynow's real hash |
| Server-side reconciliation | **Proven live 2026-09-27** | `payment_intents` persists `pollurl` at initiation; `POST /api/payments/reconcile` re-authenticates the poll reply and re-checks reference/amount/currency against Postgres before passing it to the same ledger. Unit + route tests cover valid `Paid`, valid `Cancelled`, invalid signature, tampered field, wrong amount, wrong reference, unknown status, duplicate check, already-paid, in-flight stays pending, provider unreachable, no session stored, non-Paynow address, wrong currency, and a browser-supplied `status` being ignored. **Live proof (production, 2026-09-27):** a completed hosted payment moved `AWAITING_PAYMENT → PAID` through this route with exactly one audit event (`source: pollurl`); a hostile body (`status: Failed`, `amount: 0.01`) and a duplicate check wrote nothing — see *Reconciliation proof* below |
| Signature verification | **Verified in tests** | both official hash vectors asserted in `paynow.test.ts` |
| Amount + currency verification | **Verified in DB** | harness: wrong amount, wrong currency rejected, nothing written |
| Unknown transaction rejected | **Verified in DB** | harness: `transaction_not_found` |
| Duplicate / replayed event | **Verified in DB** | harness: `already_paid`, `already_failed`, `already_refunded`, one audit row each |
| Failed payment handling | **Verified in DB** | harness: `AWAITING_PAYMENT → FAILED` |
| Refund state transition | **Verified in DB** | harness: `PAID → REFUNDED` |
| Sandbox / test mode | **Exercised 2026-09-26** | merchant login, hosted `TESTING` card and express test numbers (`0771111111` success, `0773333333` cancelled); Paynow's ledger recorded every payment as Paid/Cancelled |
| Server-initiated cancellation | **Not available** | no documented endpoint — `cancel()` refuses rather than no-ops |
| Escrow / split payment to sellers | **Not available (Zimbabwe)** | only Paynow Poland publishes `transfers[]` |
| End-to-end sandbox transaction | **DONE 2026-09-26** | `AWAITING_PAYMENT → PAID` on production from a genuine Paynow-signed message; cancel path `→ FAILED`; results below |

### Open questions (unresolved, deliberately)

1. **Hash concatenation on inbound messages.** The *Generating Hash* page says
   concatenate the values only; a separate page about the Custom Button
   Template says concatenate *key plus value*. Our implementation follows the
   primary page plus its worked examples. **Resolved 2026-09-26:** Paynow's
   own signed message (fetched from `pollurl`) verified on the first attempt
   with values-only concatenation, no key inside the message.
2. **Whitespace in values.** Paynow's published outbound example contains a
   leading space in `returnurl= http://...` yet publishes a hash that only
   reproduces when the value is trimmed; we trim. **Resolved 2026-09-26:**
   the live Paynow message verified with trimming, as did every field we
   re-sign and replay.
3. **Paynow reference uniqueness per merchant reference.** Our `reference` is
   the transaction UUID. The same reference was initiated **six times** in test
   mode (four hosted, two express) and Paynow issued a distinct
   `paynowreference` each time with no corruption on our side — the database
   allows only `AWAITING_PAYMENT → PAID` once. The intent record to correlate a
   `pollurl` **is now persisted** (`payment_intents`, one row per transaction,
   latest initiation wins) — that is what makes server-side reconciliation
   possible at all, and it was built on 2026-09-27.
4. **Refunds.** Endpoint availability for an advanced-integration merchant is
   unconfirmed; `PAID → REFUNDED` is implemented and tested, but how Paynow
   reports a refund to *this* kind of merchant must be confirmed in test mode.
5. **Disputes.** `Disputed` is recorded in the audit log and changes no state;
   no dispute-resolution flow exists.

### Test-mode verification — 2026-09-26

Run against production (`https://bid-blitz-ten.vercel.app`) with a real Paynow
merchant account in test mode. Credentials are Vercel **Production secrets**,
never in git or `.env.example`.

| Proof-list check | Result | Evidence |
| --- | --- | --- |
| Credentials wired | Pass | both `PAYNOW_*` set in Production; provider boots, `no_payment_provider` is gone |
| Initiation | Pass | `initiatetransaction` → `browserurl`; `remotetransaction` → `paynowreference` |
| Redirect alone does not pay | Pass | browser returned from Paynow; the transaction stayed `AWAITING_PAYMENT` for 60s+ |
| Genuine callback accepted | Pass | Paynow-signed message → `200` → `AWAITING_PAYMENT → PAID`, `provider=paynow`, `provider_reference` recorded, one audit row |
| Duplicate delivery | Pass | byte-identical replay → `200`, no second audit row, state unchanged |
| Replayed / tampered message | Pass ×6 | amount, status, hash truncation, field reorder, wrong key, reference swap → all `400 invalid_signature` |
| Wrong amount (fresh row) | Pass | `400 amount_mismatch`, nothing written |
| Unknown / non-uuid reference | Pass | `400 unknown_transaction` |
| Unsigned and malformed bodies | Pass | `invalid_signature`, `empty_body`, `invalid_json`, `unsupported_body`, `unrecognized_payload` |
| Cancelled payment | Pass | Paynow `Cancelled` → `AWAITING_PAYMENT → FAILED`, never `PAID` |
| Buyer-forged success | Pass | unsigned `Paid` claim → `400 invalid_signature`, state untouched (10/10 on both fixtures) |
| Production UI | Pass | transactions page shows Paid and Failed rows at `$10.00 / $0.50 (5% fee) / $9.50` |

Paynow's status message carries no currency field, so a *live* wrong-currency
case cannot be produced; that check lives in `mark_transaction_paid()` and is
covered by the engine harness.

Two behaviours worth naming explicitly:

- On an already-`PAID` row, `mark_transaction_paid()` returns `already_paid`
  **before** the amount check — the documented, retry-safe order. A
  correctly-signed message carrying the wrong amount is therefore acknowledged
  with `200` and writes nothing; state, amounts and the audit log were all
  verified unchanged.
- Paynow probed `resulturl` with GET at initiation (405 until the webhook
  gained a stateless GET probe, then 200) and **never POSTed a status update**
  for any of the five test transactions. `pollurl` did answer, and polling it is
  how the genuine `Paid` and `Cancelled` messages above were obtained.

### Reconciliation proof — 2026-09-27

A second production run closed the loop the 2026-09-26 run left open: the
fallback built that same day was exercised against a genuinely completed hosted
payment, end to end, on `https://bid-blitz-ten.vercel.app`.

| Proof-list check | Result | Evidence |
| --- | --- | --- |
| End-to-end hosted payment → `PAID` | Pass | transaction `9eed5892-8da5-4303-b707-8b71f4a87b18`: `AWAITING_PAYMENT` at the hosted page, still `AWAITING_PAYMENT` after the browser returned (redirect alone did not settle, zero `resulturl` POSTs), then `POST /api/payments/reconcile` fetched Paynow's signed `pollurl` message and the ledger wrote `PAID` — `provider=paynow`, `provider_reference=63046856`, amount `1000` minor `USD` |
| Exactly one audit event | Pass | single `payment_events` row `paynow:9eed5892-…:63046856:paid`, `source: pollurl`, received `2026-09-27T10:12:24Z`, payload carries Paynow's genuine SHA-512 `hash` |
| Duplicate reconcile is a no-op | Pass | second check on the `PAID` row answered `already_final` without contacting Paynow; `eventCount` stayed `1` |
| Browser cannot fake the outcome | Pass | hostile reconcile body `{status:"Failed", amount:"0.01"}` ignored — the row stayed `PAID`, `reconciled:false` |
| Second checkout refused | Pass | `409 not_awaiting_payment` |
| `Created` never settles | Pass | second initiation (transaction `600e4ac8-…`, `paynowreference=63048942`) abandoned at Paynow's merchant-login gate; `pollurl` answered a signed `Created` message → one `:created` audit event, status stayed `AWAITING_PAYMENT` |
| `resulturl` push | **Still not observed** | two further initiations on 2026-09-27 (one completed, one abandoned) — Paynow GET-probed nothing new and POSTed nothing; the transition arrived only via `pollurl` |

The PAID transition above was therefore delivered **solely** by server-side
reconciliation of Paynow's signed `pollurl` message. The `pollurl` fallback is a
proven mitigation, not a fix: `resulturl` remains the primary signal and remains
undelivered — do not describe the push as working until a genuine Paynow POST
reaches `/api/payments/webhook`.

**Status of the proof row (checked 2026-09-28):** `public.transactions` in
production is now **empty**. The proof transaction
`9eed5892-8da5-4303-b707-8b71f4a87b18` belonged to a disposable QA profile and
was removed by the engine harness's own fixture cleanup, as designed. The
evidence recorded above is a record of an observed event and is not retracted by
the row's absence — but there is no longer a live `PAID` row in the database to
re-inspect, and anyone wanting to see one must create a real paid sale rather
than resurrect a test record. For the same reason, the seller-payout backfill in
**ADR-012** had nothing to backfill; it ran clean and the `seller_payouts`
table is correctly empty.

Cancelled → FAILED was proven on 2026-09-26 (express test number `0773333333`,
table above). A repeat attempt through the hosted flow on 2026-09-27 could not
reach a cancel control: the hosted page gates every action behind the merchant
login screen, which stops automation by design.

### Information prepared for Paynow support (2026-09-27 — not yet sent)

- **Integration ID:** `27042` (test mode; the integration key is a secret and
  is never included in any message, ticket or repository).
- **Production result URL:** `https://bid-blitz-ten.vercel.app/api/payments/webhook`
  — answers `200` to the GET reachability probe (observed: Paynow GETs it at
  initiation) and is ready to accept signed POSTs.
- **Test initiations:** eight in total across seven test transactions —
  2026-09-26: six initiations (four hosted, two express); 2026-09-27: two
  hosted (one completed at ~10:11 UTC, one abandoned at the merchant-login
  gate at ~10:30 UTC).
- **What Paynow accepted:** at least one payment completed in test mode and was
  recorded as Paid on Paynow's side; its signed status message was fetched from
  `pollurl` and verified by this integration (hash accepted on first check).
- **What was not delivered:** for every one of those initiations, Paynow
  recorded the final status (Paid/Cancelled) and **never POSTed a status update
  to `resulturl`**, even after the endpoint began answering the GET probe with
  `200`. `pollurl` answered every signed request.
- **The ask:** why status updates are not being delivered to this integration's
  `resulturl`, and what (if anything) must change for POST delivery to work —
  required before requesting "Set Live".

No response from Paynow has been received; nothing above is paraphrased from
one.

### The manual step still required

Before requesting **"Set Live"** in the Paynow dashboard: ask Paynow why status
updates were not delivered to this integration in test mode. The `pollurl`
fallback is now built (2026-09-27), so a silent push degrades to an explicit
server-side reconciliation instead of a stranded sale — but a fallback is not a
fix, and the push itself must not be described as working until a real Paynow
POST reaches `/api/payments/webhook`. Rotate the Integration Key ("Generate New
Key") after this shared key has been used in testing. Until a push is observed,
payment is **verified as a receiver, a state machine and a reconciler**, not as
a delivery path BidBlitz has observed Paynow use.

### The marketplace question this integration has not been asked

API success is not business-model approval. A working `initiatetransaction` and
a verifiable signed callback prove that Paynow *can* collect a payment. They say
nothing about whether Paynow *permits* a merchant to collect money **for
third-party sellers** and then pay those sellers onward — which is what an
auction marketplace is, and what BidBlitz is.

**No such confirmation exists, and none is assumed.** The question is drafted
as point 5 of `docs/PAYNOW_MARKETPLACE_SUPPORT_REQUEST.md`, together with
points 6–11 (required seller documents, BuySafe's applicability when the payee
is the operator, the refund endpoint for an Advanced Integration merchant,
whether any split-settlement mechanism exists in Zimbabwe, the `resulturl`
non-delivery, and "Set Live" requirements). **That message has not been sent and
no response has been received. Nothing in this ADR, or anywhere else in this
repository, should be read as Paynow having approved the marketplace model.**

The consequence is concrete, and it is why **ADR-012** was built the way it
was: because there may be no automated split settlement available to us at all,
the payout path has to be modelled as an explicit, recorded, human operation
rather than an assumed side-effect of checkout. The design does not depend on
Paynow approving anything, and does not pretend it has.

## ADR-012: Seller payouts — a separate, admin-driven operation, never a payment status

Status: Accepted — implemented 2026-09-28 (migrations
`20260928000001_seller_payouts.sql`, `20260928000002_seller_payout_delivery.sql`)
Date: 2026-09-28

### Context

ADR-011 established the payment side and stopped exactly where it had to: the
buyer's money is collected by Paynow and settles into the **platform's** bank
account. There is no seller-facing payout API in Paynow Zimbabwe, no escrow and
no split settlement, so every onward payment to a seller is a **manual bank
transfer made by a person**.

That left BidBlitz with a real and specific lie available to it. `transactions.status`
carries `PAID`, and a seller's dashboard showed that badge. A seller reading it
had every reason to conclude they had been paid. Nothing in the product recorded
whether a seller *had* been paid, whether delivery happened, or whether a payout
was stuck behind a dispute — so an operator doing it manually had nowhere to put
it, and the audit trail did not exist.

The tempting fix is to add `SELLER_PAID` to `transactions.status`. That is
exactly the wrong fix, and this ADR exists to record why.

### Decision

**Keep the payment status exactly as Paynow reports it, and add a separate
`seller_payouts` operation for the seller's money. The browser never writes to
it; one admin-only, `SECURITY DEFINER` function is the only writer; the amount
is frozen from the transaction at creation and is immutable for every role.**

#### Why not extend `transactions.status`

`transactions.status` means one thing and only one thing: *what Paynow told us
about the buyer's payment*. Extending it to describe the seller's fulfilment
would:

- make a single column mean two unrelated things, so every reader — the buyer
  dashboard, the seller dashboard, the admin queue, a future report — would have
  to know which of the two it is looking at;
- put seller-side states into a table whose `status` is protected by
  `private.transactions_protect_state()` and whose money columns are immutable
  for every role. A seller payout legitimately changes over days; a payment
  confirmation is a fact that arrives once and never changes;
- make it possible for the application to imply automatic settlement. A
  `SELLER_PAID` state on the payment row reads as "the platform split the money",
  which is precisely the claim ADR-011 says cannot be made. Keeping them apart
  makes the manual step visible in the data model instead of hidden in a word.

#### The model

```
AWAITING_PAYMENT ──Paynow──> PAID
                                 │  (AFTER UPDATE trigger on `transactions`)
                                 ▼
seller_payouts.status:
  WAITING_FOR_FULFILMENT ──> DELIVERY_CONFIRMED ──> PAYOUT_PENDING ──> PAYOUT_DUE ──> PAID_OUT
          │                        │                     │              │             (terminal)
          └────────────────────────┴─────────────────────┴──────────────┴──> HELD
          └────────────────────────┴─────────────────────┴──────────────┴──> DISPUTED
                     HELD / DISPUTED release back into the flow
```

- `amount_minor` and `currency` are copied from `transactions.net_minor` /
  `transactions.currency` when the row is created, and are immutable for
  **every** role — engine, `service_role`, admin, browser. A fee recalculation
  can never rewrite what a seller was owed for a sale that already happened.
- The row is created by a **trigger**, not by an application call, so it cannot
  be forgotten, skipped, duplicated or back-dated. A migration backfill gives
  already-`PAID` transactions the same row with the same frozen money.
- `PAYOUT_PENDING` is "waiting for the provider to settle"; `PAYOUT_DUE` is
  "payable now". They are different questions and the money must be in the bank
  before the second one is answered.
- `PAID_OUT` requires a `payout_reference` and a `paid_at` (enforced by a CHECK
  constraint *and* by the writer), and is refused against a transaction that is
  not `PAID`/`SETTLED`. It is terminal: no transition out of it exists, so a
  recorded external transfer cannot be quietly un-recorded through the UI.
- `delivery_confirmed_at` is stamped by the transition itself rather than
  derived from the current status, so the delivery fact survives a later hold or
  dispute instead of becoming unknowable.
- A `REFUNDED` transaction holds its payout automatically, unless it was already
  recorded as paid out — in which case the administrator deals with it out of
  band, because their own record must not be silently rewritten.

#### Why the browser cannot touch it

| Control | Where |
| --- | --- |
| `INSERT`/`UPDATE`/`DELETE` revoked from `anon` and `authenticated` | migration 0001 |
| RLS `SELECT` for admins only; no write policy at all | migration 0001 |
| Money/identity columns frozen for every role in a `BEFORE UPDATE` trigger | `private.seller_payouts_protect_state()` |
| Only privileged roles may update at all (`current_user` check) | same |
| Explicit transition map; `PAID_OUT` terminal | same |
| One writer: `public.admin_transition_seller_payout()` | migration 0001 |
| That function re-reads `profiles.is_admin` on the **caller's own session** | same |
| `search_path = ''`, objects schema-qualified, `EXECUTE` revoked from `PUBLIC`/`anon` | same |
| Every state and reference change appended to `seller_payout_events` with `auth.uid()` | `private.seller_payouts_audit()` |

Sellers cannot read the table at all: there is deliberately no seller-facing
RLS policy, because one would also expose `internal_note` and the payout
reference. `public.my_seller_payouts()` returns six safe fields and nothing
else. The engine harness asserts exactly that field set.

#### What `PAID_OUT` means, precisely

**An administrator has already transferred the proceeds, outside BidBlitz, and is
recording the reference.** The application holds no banking credentials, calls
no transfer API, and fakes nothing. The confirmation dialog in the admin queue
says this in those words, because a button labelled "record seller payout" is
otherwise indistinguishable from a button that pays people.

#### Consequences

- A marketplace on this architecture needs a **human** in the loop for every
  seller payment. That is the honest cost of Paynow Zimbabwe having no split
  settlement, and it is an operational fact, not a defect to be papered over.
- Nothing in this design assumes Paynow approves the marketplace model. If it
  does not, the payments need a different provider — but the fulfilment and
  payout record, the audit trail and the admin workflow all remain correct,
  because they never claimed to be an automated split.
- The support query asking whether that model is permitted at all is
  `docs/PAYNOW_MARKETPLACE_SUPPORT_REQUEST.md` (point 5). It has not been sent.
  See **ADR-011**, *The marketplace question this integration has not been
  asked*.
- Seller bank details are **not** collected — no field, no column, no upload.
  Storing them is a separate decision with its own security and legal weight,
  and it should wait until Paynow has said what a seller must provide.

## ADR-013: An avatar is a storage key in a user-scoped namespace, never a URL

Date: 2026-09-28

Status: Accepted

### Context

`profiles.avatar_url` was a free-text `text` column with a `CHECK` of none, and
the UI rendered it straight into an `<img src>` in three places. Because
`profiles_update_self` allows a user to update their own non-privilege columns,
any signed-in user could set it to any string they liked and the site would then
load a remote image of their choosing on the header of every page, the profile
masthead and every auction they sell:

- a **tracking pixel** for every visitor who loaded a page with that profile on
  it, from a host the owner never approved;
- a **per-visitor remote dependency** on a page about money, reachable by a
  third party;
- and a URL that could be **swapped after the fact** without leaving any audit
  trail, so a picture on a profile was never evidence of anything.

An avatar is public information. That is the only reason it was tempting to let
a URL be acceptable — and it is also exactly why an avatar must still be an
object *we* host.

### Decision

The free-text column is **removed**, not constrained, so the shape cannot be
reintroduced by accident. `profiles.avatar_path` holds a storage **key**, and a
key has exactly one legal shape:

```
<owner auth uid>/avatar.<ext>        ext in jpg | jpeg | png | webp | gif
```

Four independent layers enforce it, and each is a real boundary rather than
defence-in-depth theatre:

1. **The shape** — a `CHECK` constraint on the column. No scheme, no leading
   slash, no backslash, no traversal segment, no other bucket.
2. **The owner** — `WITH CHECK` on `profiles_update_self` requires
   `split_part(avatar_path, '/', 1) = auth.uid()::text`. The `CHECK` proves the
   value *looks* like a key; this proves it is *yours*. A user cannot point their
   own profile at another user's valid key.
3. **The folder** — every `storage.objects` INSERT/UPDATE/DELETE policy for the
   `avatars` bucket requires `(storage.foldername(name))[1] = auth.uid()::text`
   and a filename matching the caller's own uid. The folder is derived from the
   verified session on the server, never from anything the browser sends.
4. **The bytes** — the upload is a server action that identifies the format from
   **magic bytes**, never from the browser's MIME type and never from the
   filename, because both are chosen by whoever picked the file. SVG is excluded
   outright: it is an XML document that can carry script, and serving one from
   our own origin is a stored-XSS vector. The bucket's `allowed_mime_types` and
   `file_size_limit` are an independent second gate on the same two properties.

The bucket is **public for reads** — that is what keeps profile pages cacheable
without a signed request per visitor — and closed for every write.

**One avatar per user, at one deterministic key**, uploaded with `upsert`, so
changing your picture cannot accumulate objects and cannot leave an orphan. A
failed profile update removes the object it had just written, so the bucket
cannot drift out of agreement with the table.

`src/lib/avatar.ts` is the only place that turns a key into a URL, and it
returns `null` for anything that is not one of ours. The single `UserAvatar`
component is the only thing that renders one. That is why a URL can no longer
reach an `<img>` even if a future query selects the column by accident: the
component would refuse it and show initials.

### Consequences

- `alt=""` on the avatar image. The person's name is always adjacent as real
  text, so the image is decorative and a non-empty alt would duplicate it. When
  there is no picture the fallback initials are the name, marked `aria-hidden`.
- The fallback is **deterministic** (`initialsFor`): the same name yields the
  same two letters in every surface, never an empty circle, never more than two
  characters. A face-less profile that changes shape between the header and the
  profile page reads as broken.
- The old `avatar_url` column was dropped, so any value in it was discarded
  rather than migrated. Measured before the change: zero rows had one, so this
  loses nothing.
- `next/image` may only optimise hosts listed in `images.remotePatterns`, so the
  Supabase hostname is read from `NEXT_PUBLIC_SUPABASE_URL` — not hard-coded, so
  pointing at a different project needs no code change.
- **No server-side resizing.** That needs an image pipeline the free-tier rule
  keeps out of the MVP. The controls are the 2 MB cap, `object-cover` in a fixed
  square frame (so the space is reserved and nothing shifts), and `next/image`
  with an explicit `sizes` hint. Recorded in `docs/POST_LAUNCH_BACKLOG.md`.

### A limit worth stating plainly: deletion is not instant at the public URL

Measured in production on 2026-09-28. After a user removed their picture, the
`profiles.avatar_path` was null and `storage.objects` held **zero** rows in the
`avatars` bucket — the removal had genuinely succeeded at both the database and
the storage layer. A `GET` on the public bucket URL nevertheless returned
**HTTP 200 with the deleted image**, because Supabase's CDN still had it.

So the object is gone but the bytes remain retrievable from a URL the user (or
anyone who saw it) can construct, until that cache entry expires. There is no
cache-purge capability on the free tier, so the only lever is the TTL.

`cacheControl` is therefore **one hour**, not the year this first shipped with. A
year would mean a photograph someone deliberately removed stays downloadable
from a known URL for a year; an hour bounds that to something a person would
accept, at the cost of one origin read per avatar per hour. This is a real
residual exposure and it is documented rather than papered over.

**What would actually close it:** a version counter in the key, so a replacement
produces a new URL (`<uid>/<version>/avatar.<ext>`) and an old cache entry is
never consulted again. That was rejected for now because it gives up the
deterministic one-object-per-user property, and orphan accumulation on repeated
replacements is a worse and much more visible failure than a one-hour stale
window. It is the right change if avatar replacement becomes common. Recorded in
`docs/POST_LAUNCH_BACKLOG.md`.

Note also that the app stops *referencing* a removed picture immediately —
`avatar_path` is the only thing the UI reads — so the staleness is confined to
someone who already has or can guess the object URL, not to the site itself.

### Verification

`scripts/db/verify-engine.mjs` § "avatars" — 18 checks over the real Storage and
REST APIs with real user sessions, proving among others that user A cannot write
into user B's folder, cannot escape it by traversal, cannot delete B's object,
and cannot point their profile at B's key or at any arbitrary string, that
replacement is an upsert, that anon can read but not write, and that the bucket
caps size and refuses SVG. `src/lib/avatar.test.ts` — 14 unit tests pinning the
key shape, the magic-byte sniffing, the size and type messages, and the
deterministic fallback. `e2e/avatar.spec.ts` — the UI contract, including that
an oversized file and a text file are both refused with copy that names the fix.
## ADR-014: A form is not a link - every form declares its method

Date: 2026-09-28

Status: Accepted

### Context

Every `<form>` in BidBlitz is driven by `onSubmit` plus a server action. That
works only once React has hydrated. Before hydration the element is an ordinary
HTML form, and **an HTML form with no `method` attribute defaults to GET**.

This was not a theoretical concern. A Playwright run against production
navigated to:

```
/login?email=buyer1%40bidblitz.test&password=Bl1tzVerify%212026&password=...
```

because a submit landed before the bundle had executed. The password was in
the URL, which means it was in the address bar, in browser history, in proxy
and CDN access logs, and available to be sent in the `Referer` of whatever the
page loaded next.

Nothing in the toolchain can see this. TypeScript is satisfied, ESLint has no
rule for it, `next build` succeeds, and the code reads correctly — a form with
an `onSubmit` handler looks safe. It is only visible if you either reason about
the un-hydrated state or watch a real browser lose a race.

The same shape applied to seven forms: the two credential forms, the profile
settings form, the bid form, the sell form, the review form and the report form.
Each would have put its own fields into a URL.

### Decision

**Action-driven forms declare `method="post"`.** An un-hydrated submit then
fails visibly — a 405 on a page route — instead of leaking. This is strictly
better than a broken no-JS login, and it is not a feature being given up: a
form that calls a server action from an `onSubmit` handler was never going to
work without JavaScript anyway, so the fallback behaviour was never "working",
only "quiet".

**Genuine navigation forms declare `method="get"` explicitly.** The three search
boxes really are navigation forms, a query string really is the correct result,
and they carry no secrets — so they are stated rather than defaulted, to make
the distinction from the action forms deliberate and reviewable instead of
accidental.

**A test now holds the line.** `src/components/form-method.test.ts` scans every
form in `src/` and fails if one omits `method`/`action`, if one declares a
method that is not `post`/`get`/`dialog`, if either credential form is not POST,
or if a form combines an `onSubmit` with the default GET. The scan asserts its
own coverage first, because a scan that silently finds nothing would pass
forever.

The test was verified to have teeth: reverting the one-word fix on the login
form fails three of the five assertions, and restoring it passes them.

### Consequences

- No behaviour changes after hydration — `onSubmit` calls `preventDefault()`
  and `method` is never consulted.
- The no-JavaScript path for these forms is a visible error rather than a
  credential leak. That is the intended trade.
- Progressive enhancement for the action forms (a real `action={serverAction}`
  so they work pre-hydration) is a possible later improvement. It was not done
  here because it is a rewrite of each form's submit handling, and the security
  defect is fully closed without it.

## ADR-015: Post-win communication is a transaction thread, not a social inbox

Date: 2026-10-02

Status: Accepted

### Context

After SOLD the winner and the seller had no way to reach each other inside
BidBlitz: no Q&A, no messaging, no contact exchange. The privacy page promises
emails are never shown to other users, so there was deliberately no public
contact path — which left the private path as a gap rather than a guarantee.

The rejected shape was a generic social inbox (conversations to create, join,
invite into; DMs between arbitrary users). That is a second product with its
own abuse surface, and nothing in the launch loop needs it.

### Decision

**One thread per transaction, keyed by `transaction_id` itself.** There is
nothing to create or join: the sale IS the conversation. Exactly the buyer and
the seller read and write (RLS, parties-only); administrators read in a
read-only moderator role so reported threads are actually reviewable, and no
insert/update path admits them. Message history is immutable
except the recipient's `read_at`; realtime Broadcast is a doorbell that only
triggers a server re-read; new-message alerts reuse the existing notification
row + `email_outbox` catalogue (one `new_message` critical template).

Abuse reporting reuses the existing user-target `reportAction` from inside the
thread — no new report type, no new queue. Banned accounts keep reading but
cannot write (cutting them off mid-sale would punish the counterparty).

Explicitly deferred, not forgotten: pre-sale auction Q&A, structured
delivery/contact fields (delivery is arranged in-thread for now, privately),
buyer-initiated disputes (admin can already HELD/DISPUTED a payout),
non-payment expiry, and the dead `PAID → SETTLED` edge.

### Consequences

- New table `transaction_messages` + `NEW_MESSAGE` notification type; both land
  via `supabase/migrations/20261001000001_transaction_messaging.sql` and must
  be applied with `npm run db:migrate` before the thread UI can load a thread
  (the page renders "not available" rather than crashing until then).
- The thread page answers forged ids, non-parties, and missing migration with
  the identical "not available" state: no existence oracle.
- RLS proof procedure lives in `scripts/db/verify-messaging-rls.mjs` and runs
  post-migration; action-level contract in `src/server/actions/messages.test.ts`.

## ADR-016: Linkwa selected as the marketplace provider; Paynow stays as fallback

Date: 2026-10-04

Status: Accepted (code) / pending sandbox proof (money movement)

### Context

Paynow cannot disburse to sellers — it settles to the merchant's own bank on
its own schedule and documents no payout API — so the seller-payout half of a
marketplace has no provider path under Paynow. Linkwa's public developer docs
(linkwa.co.zw/developer-apps/docs, /webhooks/docs, verified 2026-10-04) document
the missing half: payment links, per-attempt status checks, HMAC-signed
`payment.completed` webhooks with retries, programmatic payouts to verified
mobile wallets, and balances/statements. Its FAQ explicitly positions the API
for marketplaces that pay sellers.

### Decision

- Implement `LinkwaPaymentProvider` behind the existing seam
  (`src/server/payments/linkwa.ts`): payment-link creation, HMAC webhook
  verification, per-attempt status reconciliation is deliberately omitted (the
  documented status check needs identifiers the server only learns from the
  webhook itself), cancellation/refund paths honestly refuse (undocumented).
- Selection order in `config.ts`: Linkwa when fully configured, else Paynow,
  else the honest Noop. A half-set Linkwa fails loud instead of falling
  through silently.
- Payout helpers (`linkwa-payouts.ts`: link user, register wallet, instruct
  payout) are implemented and unit-tested. They are wired only to the
  admin-only payout console (`initiateLinkwaPayoutAction`), never to an
  automatic trigger: a payout sends only when an authorized admin presses
  *Pay seller with Linkwa* and confirms, and only for a payout row the
  operator has already walked to `PAYOUT_PENDING`.
- The webhook matches events to our rows through the stored intent
  (`external_payment_link_id` -> transaction via a new ledger reverse
  lookup), never through buyer-visible text; checkout resumes a recorded
  link instead of minting an untraceable sibling.
- Interactive result copy (`CheckStatusButton`, `PayButton`) takes the
  configured provider's display name as a prop. Static marketing/help/terms
  copy still names Paynow and must be rewritten as part of Linkwa go-live.

### Open items (owner-gated, sandbox required)

- Sandbox proof of collect -> webhook -> status -> payout -> statement for a
  controlled sale; Linkwa refund behavior and payout-status visibility are
  undocumented and must be established there, not assumed here.
  - 2026-10-05 progress (sandbox/linkwa-preview): a controlled $10.00 sale
    (transaction b44c3c45, link 01m45hzcdmyx32fbemvem4c1t2, receipt ZETE86CA)
    collected via a verified webhook, and a $9.50 payout (net = gross $10.00
    minus $0.50 fee) was instructed to a registered SmileCash sandbox wallet:
    payout_id 01m463ry96b1v2tbk1w42qfhjs, statement debit entry and balance
    drop $11.00 -> $1.50 confirm it. Linkwa documents NO payout webhook
    event (payment.completed only), NO payout status endpoint, and NO payout
    idempotency key — the documented webhook/status/idempotency gaps were
    confirmed in the sandbox, not assumed. Our idempotency boundary remains
    the ledger (unique transaction_id on seller_payouts, (provider, event_id)
    on payment_events). Recipient identity lives only in Linkwa
    (external_user_id/external_wallet_id); nothing payout-related exposes
    seller phone numbers in product UI or public tables.
  - 2026-10-05 admin console (sandbox/linkwa-preview): the payout helpers are
    now reachable only through `src/server/actions/linkwa-payouts.ts`, an
    admin-gated server action that derives amount, currency and recipient
    from the frozen `seller_payouts` row plus the server-side
    `seller_payout_recipients` table (service-role writes, admin-only RLS
    read, never rendered to a browser). It claims the row with the atomic
    `PAYOUT_PENDING -> PAYOUT_DUE` transition before instructing, records
    `PAID_OUT` with Linkwa's `payout_id` as the reference on success, and
    moves the row to `HELD` with the failure note when Linkwa refuses.
    Nothing pays out when a transaction becomes PAID — the first release is
    an explicit, confirmed admin action only.
  - 2026-10-05 reconciliation (sandbox/linkwa-preview): the ledger disagreed
    with the provider. The $9.50 payout above had been executed by Linkwa, yet
    the `seller_payouts` row for transaction b44c3c45 still said
    WAITING_FOR_FULFILMENT with no reference, so the console could have offered
    the same money a second time. Reconciled through the database's own state
    machine and audit trigger, without inventing fulfilment: WAITING_FOR_FULFILMENT
    -> PAYOUT_PENDING -> PAYOUT_DUE -> PAID_OUT (DELIVERY_CONFIRMED deliberately
    skipped — delivery was never confirmed), payout_reference set to Linkwa's
    01m463ry96b1v2tbk1w42qfhjs, paid_at = recording time, three append-only
    seller_payout_events rows documenting the walk with actor_id null (no
    interactive admin session exists in this environment;
    `admin_transition_seller_payout()` refuses any caller without auth.uid()).
    No new payout was sent. The row is now terminal PAID_OUT: a historical
    sandbox fixture that renders only as history, must stay out of any admin
    E2E queue expectations, and can never become actionable — the console
    additionally refuses any payout whose audit trail already records a
    provider payout.
  - 2026-10-05 migration history: the recipients table had been applied under
    Supabase's version/name (`20261005175832` /
    `seller_payout_recipients_20261005`) while the repo file was
    `20261005000001_seller_payout_recipients.sql`. The file was renamed to the
    applied version (identical content, no second migration) and recorded in
    `public.schema_migrations`; the live table and its anon revokes were
    verified before recording.
  - 2026-10-05 delivery-stamp defect — **RESOLVED** by
    `20261005210001_fix_payout_delivery_reconciliation.sql` (applied
    2026-10-05T18:48:20Z, recorded in `public.schema_migrations`). The previous
    trigger (`20260928000002`) stamped `delivery_confirmed_at` on the first
    move into `DELIVERY_CONFIRMED`, `PAYOUT_PENDING`, `PAYOUT_DUE` **or
    `PAID_OUT`**, so reaching `PAID_OUT` from `WAITING_FOR_FULFILMENT`
    necessarily claimed a delivery nobody confirmed — exactly what the sandbox
    reconciliation above hit. The fix drops `PAID_OUT` from that list (payout
    movement is not delivery proof) and documents it in the function comment,
    then clears the one fixture row in the same `begin`/`commit`, by disabling
    only `seller_payouts_protect_state` for that single guarded UPDATE and
    re-enabling it before commit — a scoped repair instead of the general
    clearing rule originally proposed here. Live verification: row
    `d6754669…` is `PAID_OUT` with reference `01m463ry96b1v2tbk1w42qfhjs`,
    `delivery_confirmed_at IS NULL`, its four audit events unchanged and still
    holding no `DELIVERY_CONFIRMED`, and a rejected `amount_minor` write comes
    back `payout_money_immutable`, which proves the protect trigger is live
    again. Residual (backlog, not a blocker): `PAYOUT_PENDING`/`PAYOUT_DUE`
    still stamp the fact — the console never offers
    `WAITING_FOR_FULFILMENT -> PAYOUT_PENDING`, so it normally follows "Mark
    delivery confirmed", but the `HELD -> PAYOUT_DUE` shortcut can still stamp
    delivery without an explicit confirmation.
- Paynow marketplace-approval answer still outstanding; either outcome is now
  non-blocking (approved => Paynow remains a configured fallback).
- Fee truth: Linkwa charges the buyer 1% + 2% on top and settles 100% of the
  listed price to the app wallet; BidBlitz's 5% stays a seller-proceeds split
  (payout = net). No fee-display code changed: gross/fee/net columns already
  model exactly that.

### Consequences

- No money moves until `LINKWA_API_KEY`, `LINKWA_BASE_URL` and
  `LINKWA_WEBHOOK_SECRET` are all real (see `.env.example`); without them the
  boot diagnostics say so and Noop stays in place.
- `findTransactionByProviderReference` added to the ledger seam (used only by
  the Linkwa webhook path); `PaymentIntentRecord` gains the already-stored
  `browserUrl`/`providerReference` fields it previously dropped.