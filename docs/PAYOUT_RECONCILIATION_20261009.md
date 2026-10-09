# Production payout reconciliation — 9 October 2026

The controlled PCA10 sale collected USD 1.20. Frozen accounting is 120 minor
units gross, 6 fee and 114 seller proceeds. Buyer-confirmed handover exists.
Payout 5bb9bd1e-dfc8-4813-a9c5-6a6a56d267ce was exclusively claimed at
20:00:12 UTC and emitted PAYOUT_ATTENTION at 20:00:13 UTC. It remains PAYOUT_DUE
with no provider reference. The original exception was discarded by the old
release handler; its HTTP status cannot be reconstructed from that audit trail.

Payments were paused again for reconciliation. The handover, dispute, listing
wallet-readiness and duplicate-instruction guards remain enabled. Do not return
this payout to a retryable state merely because its reference is empty.

## Investigation tools

Future payout failures append a sanitized audit diagnostic (HTTP status only
when available, otherwise outcome unconfirmed). Provider messages, credentials
and recipient information are never stored in that diagnostic.

GET /api/admin/linkwa-statement requires payouts.view and returns one USD
statement page (up to 100 entries), exact minor-unit amounts, IDs and dates.
It omits descriptions and recipient details, disables caching and never calls
a payout instruction or changes state. An absent entry on one page is not
proof that no payout happened. Check provider evidence before any retry.

The authenticated Linkwa dashboard showed no payout history. The replacement
production app's immediate auto-payout switch was off. Neither observation
alone establishes the outcome of an API payout instruction. The seller's saved
recipient predates the replacement app; stale app-scoped IDs are a hypothesis,
not a confirmed cause.

Validation: 612 tests across 56 files, lint and TypeScript passed. Production
build checked separately before publication. Database checks confirmed service
role audit INSERT permission and live safeguards. Full Playwright remains
blocked by the previously unavailable browser executable/download; no pass is
claimed. Verify the deployed commit and read-only production statement after
the existing Git deployment completes.
