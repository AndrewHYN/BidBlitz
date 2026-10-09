# Seller-approved Max Bid release — 2026-10-09

## Behavior

A buyer places a real binding bid and a private early-purchase offer. The seller sees pending offers in My Selling, receives a Max Bid notification, and reviews the offer on the auction. An explicit confirmation accepts only the current highest bid while the auction is LIVE and unexpired. The database locks the auction, ends the timer, and settles through the existing engine. Acceptance creates one AWAITING_PAYMENT transaction; it never collects payment, confirms handover, or releases money.

Declining or ignoring the early-purchase request does not retract its binding bid. Higher ordinary bids prevent acceptance of a lower offer. Seller self-bids, unauthorized decisions, paused/closed auctions, banned participants and unready payout wallets are refused. Replays return the same offer/sale. Offer rows are private to the buyer and seller under RLS; clients cannot write them directly. Realtime events refresh offers and sale state after commit.

## Payment improvements

An explicit SmileCash registration demand on HTTP 422 now becomes NEEDS_WALLET rather than a generic provider failure. A successfully linked provider recipient is saved before wallet registration. READY requires both returned provider IDs. Safe failure diagnostics record recipient/wallet stage and HTTP status without provider payloads or credentials. HTTP 401/403 instructs the seller to contact support about deployment authorization rather than repeatedly re-enter details. Provider requests have a 15-second timeout; payout instructions are not automatically retried.

## Verified checkpoint

- 588/588 unit tests; 53/53 files.
- ESLint and TypeScript pass; optimized production build succeeds.
- `scripts/db/verify-max-bid.sql` passes against production Postgres in one transaction rolled back at the end: self-bid, submission replay, unauthorized acceptance, outbid refusal, RLS privacy, missing-ready-wallet refusal, paused refusal, binding decline, early close, exactly one awaiting-payment sale, 5%/95% accounting, no premature payout.
- Zero persisted regression auctions/offers.
- Migration applied: `20261009063109_seller_approved_max_bid`.
- Included missing historical migration `20261008135326_fix_payout_phone_and_exclusive_claim`; it was already applied and must not be reapplied.
- `payments_enabled=false`, `fee_bps=500`, zero accounting mismatches. Payout-readiness, unresolved-dispute and payout-state guards remain enabled.
- Current wallet setup state: one ERROR, zero READY.

The prior 64/64 Playwright release smoke is historical evidence for the earlier release. This environment's missing browser executable prevented a fresh Playwright run; it is not claimed for this commit. Live public-route/browser verification is performed after deployment.

## Remaining production activation gate

A real seller must link an active SmileCash wallet through `/settings/payouts`. Then complete the controlled real Linkwa buyer payment, confirm buyer handover, and reconcile exactly one payout against the provider reference/statement with the stored 5% fee and 95% proceeds. No automated refunds were added. General payments stay paused until this real-world proof is complete. Account sign-in, real wallet identity and payment approval are not available to the agent in this session; they require the account holder's participation. Never invent READY IDs or mark money paid to bypass the gate.

## Deployment verification

The feature checkpoint was published through the GitHub connector as `a0af4e003e1a60e2d87bd39a270f70f9f2100397`; its tree SHA `30b78a161d43a0e2ea1238bb8b126b835106e74f` exactly matched the tested local checkpoint. GitHub's Vercel status succeeded. The production auction page visibly renders Max Bid, the help/terms explain early acceptance, and the public homepage, browse, auction, help, terms, payout entry and time routes returned HTTP 200 without application errors.

The Vercel management connector returned HTTP 403 for the existing team; no CLI authentication is available. `/api/version` therefore exposes only the deployment's public 40-character `VERCEL_GIT_COMMIT_SHA`, with `Cache-Control: no-store`, so the production domain can be compared directly with GitHub HEAD. It exposes no credentials or payment configuration. Public visual verification found no horizontal overflow at the observed desktop viewport. Authenticated seller/buyer UI and fresh Playwright coverage still require an available authenticated/browser test environment.
