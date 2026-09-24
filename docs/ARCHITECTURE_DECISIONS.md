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

Status: Accepted

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
