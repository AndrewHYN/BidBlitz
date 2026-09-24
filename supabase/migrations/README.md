# Supabase migrations

Apply order is the filename prefix:

| File | Purpose |
| --- | --- |
| `20260924000001_init_schema.sql` | Tables, checks, constraints, access-path indexes |
| `20260924000002_rls.sql` | RLS policies, helpers, function grants |
| `20260924000003_auction_engine.sql` | `place_bid`, `settle_auction`, publish/cancel, triggers |
| `20260924000004_storage_realtime.sql` | Storage bucket + policies, realtime publication, column grants |
| `20260924000005_indexes.sql` | Discovery/search indexes |

## How they are applied

```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npm run db:migrate
```

`scripts/db/migrate.mjs` sends each file through the Supabase Management API
(`POST /v1/projects/{ref}/database/query`) and records the filename in a
`public.schema_migrations` table so re-runs are idempotent.

## Key invariants enforced by the database

- Money is `bigint` minor units + `text currency`. No floats anywhere.
- `place_bid()` is the **only** writer of `bids` and of the auction bid
  projection. It takes `SELECT ... FOR UPDATE` on the auction row, so concurrent
  bids serialize in Postgres rather than in JavaScript.
- Idempotency: unique `(bidder_id, request_id)`; a replay returns the original
  bid instead of creating a second one.
- Anti-sniping mutates `ends_at` inside the same lock, then the caller emits
  `auction.extended`.
- `settle_auction()` is idempotent and uses `FOR UPDATE SKIP LOCKED` in the
  sweep, so an auction closes exactly once even under parallel workers.
- `fee_settings.fee_bps` is read only by server functions; clients cannot
  write it (no RLS policy + `REVOKE`).
