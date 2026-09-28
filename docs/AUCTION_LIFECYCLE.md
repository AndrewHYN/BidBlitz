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

## `ENDED` is unreachable, and that is deliberate

No function, trigger or policy assigns it. It is verified rather than assumed:
`select ... where status = 'ENDED'` is not in the suite, but a repository-wide
search of the migrations finds no assignment, and the only places it appears are
defensive — `isClosed()` and the guard in `place_bid` that refuses a bid on
anything already finished.

The reason it is not needed: **the clock decides that an auction has ended, and
the status records the outcome.** An auction whose `ends_at` has passed but which
has not been settled yet is still `LIVE`, and everything that matters reads the
server clock rather than the status:

- `isBiddable()` returns false once `ends_at` is in the past, so no bid is
  accepted;
- the bid panel shows the closed state;
- the seller's dashboard offers the settle action;
- the sweep and the countdown handler settle it.

Introducing an `ENDED` intermediate state would mean deciding who moves an
auction into it, and every reader would then have to handle "ENDED but not yet
sold". `SOLD` and `UNSOLD` already carry everything. It is left in the enum
because removing an enum value is a schema migration with real risk and no
benefit, and because the defensive references are harmless.

If a future change does need to assign it, the lifecycle table above is the
contract to update first.

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

## Known limitation: a refused late bid does not settle the auction

`place_bid()` on an auction whose clock has passed calls `settle_auction()` and
then raises `auction_ended` to refuse the bid. **The raise rolls the settlement
back.** The bid is refused correctly; the settlement does not survive, and the
row stays `LIVE`.

This was measured, not reasoned about. The check is deliberately phrased as an
assertion of the limitation rather than removed or left failing:

> `CASE A: KNOWN LIMITATION - a refused late bid does not itself settle the
> auction` — expects `LIVE`.

Settlement is carried by the other two triggers, both of which work:

1. **Page view.** `auction-detail-live.tsx` calls `settleIfDueAction()` when a
   viewer's countdown reaches zero, then refreshes.
2. **Read path and cron.** `sweepDueAuctions()` — throttled to once a minute per
   instance, non-fatal, and non-authoritative — calls `settle_due_auctions()`,
   and the cron route calls the same function.

Two working triggers is why no single missed path leaves the tables lying. The
`perform settle_auction(...)` in `place_bid` is left in place: it costs one
wasted function call per refused late bid, and it would become effective if that
`raise` were ever converted into a returned rejection. Both comments that
previously claimed this was a working trigger are corrected.

Converting it would mean changing `place_bid`'s error contract from a raised
exception to a returned rejection, which reaches the server actions, the
classification layer and the tests. That is an engine contract change, not a
defect fix, and it is not worth making without a reason that outlives this note.

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
