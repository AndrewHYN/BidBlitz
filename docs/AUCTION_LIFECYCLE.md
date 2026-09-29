# The auction lifecycle

What the database actually does, verified rather than inferred. Every claim here
is asserted in `scripts/db/verify-engine.mjs`; the check name is given so the
claim can be re-tested rather than trusted.

## The statuses

`auction_status_t` has seven values. Six are reachable. One is not.

```
DRAFT ──publish──> SCHEDULED ──clock──> LIVE ──settle──> SOLD      (had a winning bid)
                     │                    │
                     │                    └──────settle──> UNSOLD  (no bids)
                     │
                     └──cancel──> CANCELLED

CANCELLED is also reachable from DRAFT, and from any state that has no bids.
```

| Status | Produced by | Meaning |
| --- | --- | --- |
| `DRAFT` | sell form | Editable. Nothing is public, nothing is bidden. |
| `SCHEDULED` | `publish_auction` with a future `starts_at` | Public, not yet open. Biddable. |
| `LIVE` | `publish_auction`, or the clock reaching `starts_at` | Open for bids. |
| `SOLD` | `settle_auction`, had a winning bid | Closed with a winner. Exactly one transaction. |
| `UNSOLD` | `settle_auction`, no bids | Closed with no sale. **No transaction.** |
| `CANCELLED` | `cancel_auction` | Withdrawn before it could sell. |
| `ENDED` | **nothing** | Unreachable. See below. |

## `ENDED`: a display value, never a stored state

No function, trigger or policy assigns `ENDED` to the `status` column. Verified
by repository-wide search of every migration: the only writers are
`publish_auction` (DRAFT→SCHEDULED/LIVE), `place_bid` (bid projection only),
`settle_auction` (LIVE→SOLD/UNSOLD), and `cancel_auction` (→CANCELLED).

`ENDED` does have one legitimate producer, and it is not a writer:
`auction_effective_status()` returns the *text* `'ENDED'` for a LIVE row whose
`ends_at` has passed. Nothing in the app calls that function today — the
dashboards and cards re-derive the same fact inline (`status === "LIVE" &&
ends_at <= now`), and the countdown shows "Ended · awaiting results" from the
clock. Two dashboard filters also test `item.status === "ENDED"`; those
branches are dead, because the status they read is the stored one, but each
sits beside the live `LIVE`-plus-expired check that does the real work, so
they are misleading rather than wrong.

The rule, so nobody has to re-derive it: **the clock decides that an auction
has ended, and the status records the outcome.** An auction whose `ends_at` has
passed but which has not been settled yet is still `LIVE`, and everything that
matters reads the server clock rather than the status:

- `isBiddable()` returns false once `ends_at` is in the past, so no bid is
  accepted;
- the bid panel shows the closed state;
- the seller's dashboard offers the settle action;
- the sweep, the countdown handler, and (since migration 20260929000001) a
  late bid itself settle it.

Introducing a stored `ENDED` intermediate would mean deciding who moves an
auction into it, and every reader would then have to handle "ENDED but not yet
sold". `SOLD` and `UNSOLD` already carry everything. It stays in the enum
because removing a value is a schema migration with real risk and no benefit —
`ALTER TYPE ... DROP VALUE` against a live database, plus every defensive
reference (`isClosed()`, the `place_bid` guard, the badge, the type union)
would have to change in lockstep — and because the defensive references are
harmless as long as nobody mistakes them for producers.

If a future change does need to store it, the lifecycle table above is the
contract to update first, and the two dead `=== "ENDED"` dashboard branches
are the first place it would take effect.

## Settlement is idempotent, and proven so

`settle_auction()` returns immediately unless the row is `LIVE`, so it closes
exactly once no matter how many times it is called.

- **CASE B, sold** — "closing twice creates only ONE transaction (idempotent)".
- **CASE A, unsold** — "settling an unsold auction again is idempotent and stays
  unsold", plus "NO transaction is created for an auction that did not sell".

A second settlement cannot duplicate a transaction, a winner notification, or a
profile count increment, because it does no work at all.

## The endings that produce no money were untested, and are now covered

CASE B had thorough coverage. The endings that produce **no** sale had none, and
"nobody bid on it" is the single most common outcome a real marketplace
produces. Eleven checks now cover it, including:

- closes to `UNSOLD` with a null winner and a null winning price;
- **no transaction row**, which is the one that matters — a zero-value "sale"
  would invent a financial record and a payout obligation for an item nobody
  bought;
- no bid flagged winning;
- the seller receives `ENDED_UNSOLD`;
- `CANCELLED` is distinguishable from `UNSOLD`, and a cancelled auction can
  never be settled into a sale.

`CANCELLED` and `UNSOLD` are deliberately different states. Both mean nothing
sold, but one is "the market did not want it" and the other is "we withdrew
it". Collapsing them would tell a seller their item was rejected on the open
market when it was not.

## Fixed: a refused late bid settles the auction (migration 20260929000001)

`place_bid()` on an auction whose clock has passed calls `settle_auction()` and
then reports the refusal as a **returned** `{ok:false, error:'auction_ended'}`.
The transaction commits with the settlement persisted and no bid written.

This used to be a `raise`, and a raise aborts the enclosing transaction — so
the settlement was rolled back with it, the bid was refused correctly, and the
row stayed `LIVE`. It was measured, not reasoned about: the CASE A checks
placed a bid on an expired auction, confirmed the refusal, read the row back,
and found it still `LIVE`. The suite check was even phrased as an assertion of
the limitation ("KNOWN LIMITATION - expects `LIVE`") rather than left failing.

The fix keeps the caller contract intact on purpose. `placeBidAction()` already
handles `!payload?.ok` through `normalizeEngineError()`, which reads the
`error` field — so the user sees exactly what they saw before ("Auction has
ended."). PostgREST callers see HTTP 200 with the error inside the body instead
of HTTP 4xx with a raised message; the checks in `scripts/db/verify-engine.mjs`
assert the new shape, including that the row is settled afterwards. Nothing any
human reads changed; only the settlement now survives, which is the entire
point of calling it.

Every other `raise` in `place_bid()` is untouched, deliberately: those paths
change nothing, so rolling back is correct there, and a refusal that writes
nothing must keep failing closed with an exception.

Settlement is therefore carried by three triggers that all work:

1. **Bid.** `place_bid()` settles a clock-expired auction inside the same row
   lock, then refuses the bid with the settlement committed.
2. **Page view.** `auction-detail-live.tsx` calls `settleIfDueAction()` when a
   viewer's countdown reaches zero, then refreshes.
3. **Read path and cron.** `sweepDueAuctions()` — throttled to once a minute per
   instance, non-fatal, and non-authoritative — calls `settle_due_auctions()`,
   and the cron route calls the same function.

No single missed path can leave the tables lying, because no path depends on
another: each one settles idempotently through `settle_auction()`, which closes
exactly once no matter how many times it is called.

## What the UI shows, per ending

| Ending | Seller | Buyer | Money |
| --- | --- | --- | --- |
| `UNSOLD` | "This auction ended with no bids, so nothing was sold." | "No bids were placed: this auction closed unsold." | No transaction, no payout. |
| `SOLD` | Sold amount, 5% fee, proceeds, and the payout badge | "You won" plus the payment path | Transaction `AWAITING_PAYMENT`. Payout is a **separate** state. |
| `CANCELLED` | "This auction was cancelled before anyone bid." | "This auction was cancelled." | No transaction, no payout. |

The buying dashboard shows no badge at all for a closed auction
(`badgeFor` returns `null` once `isClosed`), so a losing bidder is never told
"you've been outbid" about a finished auction — the outcome belongs on the
detail page, not smeared across a card.
