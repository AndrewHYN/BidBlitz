# Marketplace Operations — internal SOP

**Audience:** whoever runs a sale end to end. This is an operating manual, not
marketing and not a contract. Where it says "Paynow does X", that is Paynow's
documented process, not BidBlitz's, and it can change.

**Scope note that must not be skipped:** BidBlitz is a marketplace where the
buyers pay the *platform* and the *platform* then pays sellers. Paynow
settles into the platform's registered bank account. There is no automatic
split, no escrow and no seller-facing payout API. Every seller payment is a
manual, human-executed transfer that an administrator records afterwards.

Nothing in BidBlitz sends money. "Record seller payout" means an operator has
already made the transfer through their own bank and is writing down its
reference.

---

## 0. The two states that must never be confused

| Record | What it means | Who moves it |
| --- | --- | --- |
| `transactions.status` | The **buyer's** payment, exactly as Paynow reported it | Paynow, via a signed message |
| `seller_payouts.status` | The **seller's** money: is it owed, held, due, or already paid | An administrator, in `/admin` |

`PAID` on a transaction means "Paynow confirmed the buyer paid the winning
bid". It does **not** mean the seller has been paid, and it must never be shown
or described as if it does.

---

## 1. Money flow, exactly as it works

```
BUYER                    PAYNOW                     PLATFORM                     SELLER
  |                        |                          |                           |
  | pays winning bid       |                          |                           |
  | + Paynow charge  ----->|                          |                           |
  |                        | settles to the            |                          |
  |                        | platform bank account <---|                           |
  |                        |                          |                           |
  |                        |                          | confirm delivery           |
  |                        |                          | payout becomes due         |
  |                        |                          | ---- manual transfer ----> |
  |                        |                          | record the reference       |
```

Two things follow, and both must be said to users:

- The buyer pays **winning bid + the applicable Paynow charge**. That charge is
  Paynow's, is calculated and displayed by Paynow before the buyer authorises
  anything, and is not revenue BidBlitz receives.
- The seller receives **winning bid − the 5% BidBlitz platform fee**, paid later,
  after fulfilment and after the buyer's window to dispute has passed.

---

## 2. Seller onboarding

BidBlitz does **not** collect identity documents, tax numbers or bank details.
No KYC fields exist in the product and none should be added until the actual
requirements are known (see `docs/COMPLIANCE_LAUNCH_CHECKLIST.md`).

What onboarding *is* today: an account with a verified email address.

1. Seller signs up at `/signup`, confirms their email, and signs in.
2. Seller creates a listing at `/sell` and publishes it. The starting price, bid
   increment, duration and closing time lock at publish and cannot be changed.
3. Seller must be contactable on the email or phone on their account. A sale
   cannot be completed without a way to reach the winner.

**Before the first real sale, the operator must still be confident the seller
is who they say they are.** That verification is a human, out-of-band process
for now. Record what was checked and when, in your own notes — BidBlitz has no
field for it, and inventing one before the requirements are known would be
worse than leaving the gap visible.

---

## 3. Creating and publishing a listing

Operator checks before a listing goes live:

- [ ] Title describes the actual item. Buyers are held to the words on the page.
- [ ] Description states real condition, including defects. "Like new" with a
      scratch is a misrepresentation and is a refundable event.
- [ ] Photos are of the actual item. Do not reuse stock photos or another
      seller's images.
- [ ] Category and condition fields match the description.
- [ ] Bid increment and duration are sensible for the item's value.
- [ ] Reserve price / starting price is realistic. A low starting price with a
      high increment produces dead auctions.

Once published, terms are frozen. A wrong listing is handled by cancelling (only
possible before the first bid) or by the dispute process, not by editing.

---

## 4. Closing the auction

The clock is server-side. Bids in the anti-sniping window extend the auction
automatically. Nothing needs to be done at the exact end time.

**Automatic:** `settle_due_auctions` runs on a schedule and settles any auction
whose clock has run out, recording the winner, the gross winning price, the
5% fee and the seller's proceeds in integer minor units.

**Manual fallback:** the seller's dashboard shows a *Settle* prompt for an
ended auction, and the seller can settle their own auction. This is the same
server function, so the outcome is identical either way.

An auction with no bids settles as `UNSOLD`. Nothing is owed to anyone.

Verify after settling: one transaction row exists, its fee maths reconciles
(`fee_minor + net_minor = gross_minor`, enforced in the database), and the
notification went to the winner.

---

## 5. Buyer payment and Paynow confirmation

The winner pays from `/dashboard/buying` or `/dashboard/transactions`. The
`Pay now` button only exists while a payment provider is configured, so a
deployment without one never shows a dead end.

What the operator is watching:

1. The buyer is sent to Paynow's hosted page. The amount sent is the winning
   bid; Paynow presents its own charge separately before the buyer authorises.
2. The transaction stays `AWAITING_PAYMENT` until Paynow's **signed** status
   message reaches BidBlitz and passes signature, amount, currency and
   reference checks. A redirect back to BidBlitz is not a payment confirmation
   and cannot settle a sale.
3. On acceptance: `AWAITING_PAYMENT → PAID`, one audit row written.

**Two delivery paths exist, and only one has ever worked:**

- `resulturl` (POST `/api/payments/webhook`) is the *primary* path. Across
  eight test-mode initiations, Paynow recorded the final status every time and
  **never POSTed to it**. It is not proven and must not be described as working.
- `pollurl` reconciliation (`POST /api/payments/reconcile`) is the *proven*
  fallback. Either party to the sale can ask the server to check that one
  transaction. The reply is hash-verified, and its reference, amount and
  currency are re-checked against Postgres before anything is written.

**Operator action while `resulturl` is unproven:** when a buyer reports having
paid and the sale is still `AWAITING_PAYMENT`, use *Check status* in the
transaction row. If the provider says `Paid`, the sale settles. If it says
`Created` or `Awaiting Delivery`, the money is not through yet — say so plainly
and ask the buyer to check their card statement and Paynow's own dashboard.

Do not "help" a stuck sale by any other means. There is no override button, by
design.

---

## 6. Fulfilment: delivery and pickup

Once the sale is `PAID`, a `seller_payouts` row exists with the seller's
proceeds frozen at `net_minor`. It starts at `WAITING_FOR_FULFILMENT`.

The seller is responsible for delivering what they listed. The operator's job is
to get a true answer and record it.

Acceptable evidence, in rough order of strength:

- **In-person handover:** the operator or a named witness confirms physical
  handover, with a date and time.
- **Courier / tracked delivery:** the courier's tracking reference, plus proof of
  delivery from the courier.
- **Both parties confirming in writing** (email, WhatsApp, SMS) that the
  handover happened, kept with the sale.

Not acceptable on their own: "the seller said so", a screenshot with no
provenance, or a delivery notification to an address the buyer never confirmed.

In `/admin → Payout operations`, use **Mark delivery confirmed** once
evidence exists. The payout status becomes `DELIVERY_CONFIRMED` and the
delivery date is stamped on the record, so it survives a later hold or dispute.

Where a listing specifies pickup, the buyer's arrival is the fulfilment event.
Where it specifies delivery, the delivery address must have been agreed with the
buyer before dispatch.

---

## 7. Disputes

A dispute blocks the payout. That is the point of it.

**Open it** in `/admin → Payout operations` with **Record dispute** as soon as
either party raises a problem. The payout moves to `DISPUTED` and stays blocked.
Recording the reason in the internal note is mandatory — the audit row keeps the
note, but a bare `DISPUTED` with no explanation is not a decision, it is a
stall.

**What to collect:** the listing as it was at the time (BidBlitz does not keep
a snapshot — capture it now), the buyer's claim, the seller's response, and any
delivery evidence. Ask for the buyer's Paynow reference and screenshot of their
payment; it is the fastest way to establish money actually moved.

**Common categories:**

| Situation | Usual outcome |
| --- | --- |
| Item not as described (material) | Refund the buyer; payout held; seller warned |
| Item never arrived | Refund the buyer; payout held; seller loses the sale |
| Arrived damaged | Buyer and seller agree a partial refund, or full refund if unusable |
| Wrong item sent | Same as not as described |
| Buyer refuses to collect | Hold, then escalate; do not auto-release to the seller |
| Buyer claims non-payment but Paynow shows `Paid` | Escalate; do not refund on a claim alone |

**Closing a dispute:** record the outcome as a note, then move the payout to
`HELD` (if the seller is not getting the money) or back into the fulfilment
flow. If money must go back to the buyer, that is a refund — see §9.

**Do not invent a deadline.** Any dispute window quoted to a user must be one
this document or BidBlitz actually states. No statutory deadline is asserted
anywhere in this repository because none has been confirmed.

---

## 8. Seller payout

Prerequisites, all of them, before a payout is paid:

1. The transaction is `PAID` (or `SETTLED`) and not `REFUNDED` or `FAILED`.
2. The seller has fulfilled the sale and delivery is confirmed.
3. The buyer's window to dispute has passed.
4. No dispute is open on the payout.
5. The operator has the money: Paynow's status is `Paid` and, for
   locally-switched methods, the settlement window has elapsed.

Then, in `/admin → Payout operations`:

1. **Mark payout due.** This states the proceeds are payable. It still moves no
   money.
2. Make the transfer yourself, through the platform's real bank process, to the
   seller using the payment details they have given you and verified out of
   band.
3. **Record seller payout.** The reference is mandatory — the button will not
   fire without it. The date is recorded automatically.

`PAID_OUT` is terminal. It cannot be reopened through the application by
design: the money left the platform, and correcting that is a human, documented,
out-of-band conversation, not a click.

**Paynow's settlement timing governs the money in, not the money out.** Paynow
documents: locally switched payments settle next day, local Visa/Mastercard
T+2, foreign Visa/Mastercard T+3, with a 20:00 cut-off; non-verified merchant
accounts settle once weekly on a Tuesday. A seller must not be paid from funds
that have not landed.

**Never** tell a seller their proceeds have been paid while the payout reads
`PAYOUT_DUE`, `PENDING` or `HELD`. Those mean the opposite.

---

## 9. Reconciliation

Reconciliation is comparing three independent things and explaining any gap:

| Source | What it tells you |
| --- | --- |
| BidBlitz `transactions` | What the platform believes is owed |
| BidBlitz `seller_payouts` | What the platform believes it has paid out |
| The bank statement | What actually moved |

**Weekly, as a minimum:**

1. List every transaction in `PAID` with a payout not yet `PAID_OUT`. For each,
   is the money in the bank? If not, why not?
2. List every payout in `PAID_OUT`. Is the transfer in the bank statement? Does
   the recorded reference appear there?
3. List every transaction in `REFUNDED` whose payout was **not** `PAID_OUT`. The
   system holds these automatically; confirm the hold is still correct.
4. Total the three columns. They should agree:
   `sum(PAID gross) − sum(refunds) − sum(seller payouts) = 5% fee revenue +
   anything still held`.

**A gap is not a rounding error to be explained away.** An unexplained gap is
the single most serious thing this SOP asks you to look at. Stop payouts, find
the cause, record it.

---

## 10. Refunds

`PAID → REFUNDED` exists, is tested, and is reachable only by the service role.
**Paynow has not confirmed a general-purpose refund endpoint for an
advanced-integration merchant** — the published reversal endpoint belongs to
BillPay, whose own documentation says most billers do not accept reversals.

Until that is confirmed in writing, a refund is a manual operation:

1. Open or record a dispute on the payout so the seller is not paid.
2. Make the repayment yourself, through the platform's real bank process.
3. Move the transaction to `REFUNDED` through the service-role writer once the
   money has actually gone back.
4. The payout is held automatically; record why in the internal note.

Never mark a transaction `REFUNDED` before the money is back. The state means
money returned, not money intended.

---

## 11. Records to keep

Per sale:

- the listing as published (capture it at settlement — BidBlitz keeps no snapshot)
- the transaction row and its `payment_events` audit trail
- the `seller_payouts` row and its `seller_payout_events` audit trail
- delivery evidence
- any dispute notes and their outcome
- the bank reference for the seller transfer, and for any refund

These are the records a tax authority, a buyer in dispute, or Paynow will ask
for. The audit tables in Postgres hold the state changes; the evidence itself is
the operator's to keep.

---

## 12. Fraud and abuse escalation

Escalate immediately, before taking any other action on the sale, when:

- A buyer claims a payment that Paynow's own status does not show.
- A seller asks to be paid to a different account, a third party's name, or
  before the sale is `PAID`.
- Repeated wins on unrelated listings from one account, or bid/retreat patterns
  that suggest shilling.
- A listing is copied from another seller, including photos.
- Any attempt to change payment or payout state outside `/admin` — that is a
  security incident, not a support ticket.

Handling: pause the payout, record the concern in the internal note, keep the
evidence, and do not confront the account. Suspending an account is an
administrative decision that should be made with the evidence in hand.

BidBlitz does not currently implement automated fraud scoring. Do not imply that
it does.

---

## 13. What an administrator does, and what nobody does

**As shipped, no account has this role.** Verified 2026-09-28: zero rows in
`public.profiles` have `is_admin = true`, so `/admin` and everything in it is
currently unreachable. The owner must set that flag on their own account
first — see `docs/COMPLIANCE_LAUNCH_CHECKLIST.md` J6 — and should be someone
who has read this document end to end.

An administrator may:

- read every payout, its audit trail and the seller's details
- mark delivery confirmed, mark payout pending or due, hold, record a dispute
- record a seller payout **with a reference**, after making the transfer
- annotate a payout with an internal note

An administrator may **not**:

- change a payout amount or currency — they are frozen from the transaction at
  creation and are immutable in the database for every role, including the
  service key
- pay out against a `FAILED` or `REFUNDED` transaction
- record a payout without a reference
- reverse a `PAID_OUT` record through the application
- create a transaction, a sale, a bid or a payment confirmation

The browser cannot do any of these things either. The application holds no
credentials capable of moving money and offers no route to a payout state that
the database has not authorised.

---

## 14. What is still externally blocked

Read `docs/PAYNOW_MARKETPLACE_SUPPORT_REQUEST.md` for the questions that must
be answered in writing before this SOP describes a live marketplace:

1. Whether Paynow permits a merchant to collect buyer funds for third-party
   sellers and make onward payments to those sellers. **No answer has been
   received. This is not approved.**
2. Why `resulturl` receives no POST in test mode, and what must change for
   delivery to work. **No answer has been received.**
3. The refund endpoint available to an advanced-integration merchant.
4. What "Set Live" requires, and what must happen to the Integration Key when
   moving from test to live.

Until (1) and (2) are answered in writing, the honest description of BidBlitz's
payment capability is: *verified as a receiver, a state machine and a
reconciler, in test mode*.
