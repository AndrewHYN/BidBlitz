# Production activation — 8 October 2026

The reviewed release `246047ded05297de263333e085611e0b4434148f` was verified
as Vercel production deployment `dpl_G3Asx3y9aZ3vaWJg3ypnJCp22kof`, READY,
with `bidblitz.co.zw`, `www.bidblitz.co.zw` and the legacy Vercel alias attached.
The public apex redirects to `https://www.bidblitz.co.zw/`.

## Repairs required before activation

- The live payout-phone CHECK and signup provisioning function used an
  overescaped regex and rejected a valid normalized Zimbabwe number. Both now
  use `^[+]263[0-9]{9}$`.
- Payout onboarding now stops before calling Linkwa if its initial database
  save fails.
- The payout transition RPC previously returned success with `already=true`
  to a second caller claiming PAYOUT_DUE. The release engine ignored that
  distinction, so concurrent workers could both instruct the provider. The
  database now refuses a claim unless the row is PAYOUT_PENDING, under its
  existing row lock. The application also requires a matching, successful,
  newly acquired claim before any payout call.
- `auction_require_payout_ready` is enabled now that the payout-settings
  frontend is in production. This guards new publishing transitions; existing
  live listings still require their sellers to finish payout setup.

Applied migration:
`20261008135521_fix_payout_activation_safety.sql`. The file version/name matches
Supabase's applied history, and the filename is also recorded in the existing
`public.schema_migrations` ledger. No previous migration was rerun or changed.

## Validation

- 578 unit tests across 52 files passed, including a two-worker release test
  requiring exactly one provider call and refusal of incomplete/reused claims.
- TypeScript, ESLint and the Next.js production build passed.
- Live Postgres rollback-only checks proved valid phone insertion, invalid
  phone rejection, first claim acquisition, duplicate claim rejection,
  unresolved-dispute blocking and publishing refusal without a ready wallet.
  Test changes were rolled back: zero payout recipients, zero open disputes,
  and the original two payout states remained unchanged.
- Public pages and production API responses were inspected. The original
  64/64 desktop/mobile Playwright result belongs to the reviewed release;
  this activation pass does not claim a fresh full desktop/mobile run or a
  signed-in financial flow.

## Payment state and remaining gates

`fee_settings.fee_bps=500`; the transaction fee and seller net remain frozen.
`payment_settings.payments_enabled=false`. Signed provider webhooks remain
accepted for reconciliation. No new charge, payout or automated refund was
sent by this activation pass.

At verification there were no seller payout recipients. The historical $10
sandbox transaction retains its recorded $9.50 payout and is never a retry
candidate. A separate $1 transaction has a $0.05 fee, $0.95 net and a
DELIVERY_CONFIRMED payout; this alone does not prove a live wallet receipt.

Before general payment activation:

1. Sign in as the intended seller and finish payout setup with their own legal
   name and activated SmileCash number. Verify READY plus provider identifiers
   in the private ledger, without exposing them publicly.
2. Verify the production Linkwa application and webhook delivery. Vercel lists
   the API key and webhook secret as sensitive variables; their values are
   not readable through the connector, so their presence is not provider proof.
3. Agree the real test transaction, buyer/seller and spending cap before moving
   real money. Keep general payments paused until a controlled test is scoped.
4. Verify provider-confirmed buyer payment, exact frozen fee/net, actual buyer
   handover confirmation, one payout instruction, provider statement and seller
   wallet receipt. An uncertain provider result requires reconciliation, never
   an automatic retry.
5. Enable general payments only after those gates pass, then smoke production
   and read back the database switch and guards.

Earlier deployment/provider notes in `DEPLOYMENT.md` and ADR-016 are historical
evidence. This dated record describes the current activation state.
