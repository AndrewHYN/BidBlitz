# Paynow — marketplace model and status-delivery query

**Status: PREPARED, NOT SENT.**

Nothing in this document paraphrases a reply from Paynow, because none has been
received. Every statement about BidBlitz's own behaviour below was observed
against the live site and is reproducible; every statement about Paynow's rules
is attributed to Paynow's published documentation.

The message body is written to be pasted as-is.

**Never include in any message, ticket, screenshot or commit:** the Paynow
Integration Key, the merchant password, or any other credential. The Integration
ID below is an identifier, not a secret, and is included so support can locate
the integration.

---

## 1. Who to send it to

Paynow merchant support, via the channel offered in the Paynow merchant
dashboard or developer hub. Attach nothing that contains a credential.

---

## 2. The message

```
Subject: Advanced Integration 27042 — marketplace payout model approval and
resulturl status delivery (test mode)

Hello,

We are building BidBlitz (https://bid-blitz-ten.vercel.app), an auction
marketplace running on your Advanced Integration, Integration ID 27042
(test mode). We would like written confirmation on a small number of points
before we request "Set Live", because our business model may not match what
your Advanced Integration is intended for and we would rather ask now than
discover it later.

1. THE BUSINESS MODEL
   BidBlitz is a multi-seller marketplace. Third-party sellers list items,
   buyers bid, and the highest bidder wins. We are NOT a single-merchant shop
   selling our own stock.

2. WHO PAYS YOU
   The buyer pays the winning bid to Paynow, in full, on Paynow's hosted
   payment page. The buyer is never told to pay a seller directly.

3. WHAT YOU SETTLE
   We understand Paynow settles to the merchant's registered Zimbabwean bank
   account — that is, to us, the marketplace operator — and not to the
   individual seller.

4. WHAT WE DO WITH THE MONEY
   Once Paynow has settled to our account, we pay each seller their proceeds
   (the winning bid less our platform fee) by our own manual bank transfer,
   after we have confirmed the sale was fulfilled, and we record the transfer
   reference against the sale in our own system. There is no automated split
   and we do not claim one.

5. THE PERMISSION QUESTION  ← the important one
   Does Paynow permit an Advanced Integration merchant to collect buyer
   payments for third-party sellers and then make onward payments to those
   sellers, in this manual model?

   Specifically:
   a) Is this permitted under the Advanced Integration product, or does it
      require a different product, contract or merchant type?
   b) Does it affect our settlement limits, or our merchant verification
      status?
   c) Are there terms, disclosures or reporting obligations that this model
      creates for us as the collecting party?
   d) Is there anything about holding funds between settlement and onward
      payment that Paynow requires or prohibits?

6. DOCUMENTS
   If this model is permitted, which documents must we provide to Paynow for
   it, and which must the individual sellers provide to us? We are currently
   collecting no identity, tax or bank documents from sellers and do not want
   to collect documents before we know what is actually required.

7. BUYSAFE
   How does your buyer-protection product (BuySafe) apply when the payee is a
   marketplace operator rather than the seller of the item? Does a buyer
   raising a problem with a seller interact with BuySafe in any way, or are
   they entirely separate processes with separate timelines?

8. REFUNDS AND REVERSALS
   Your published reversal endpoint appears to be part of BillPay, and the
   BillPay documentation states that a very limited set of billers accept
   reversals or refunds.

   For an Advanced Integration merchant:
   a) What is the correct procedure to refund a buyer?
   b) Is there a refund/reversal endpoint available to us?
   c) If not, is a refund something we must perform manually from our own
      account, and does that have any consequence for our merchant standing?
   d) How would a refund be reported back to Paynow?

9. SPLIT SETTLEMENT
   We have not found a split-settlement, sub-merchant or transfer API in the
   Zimbabwean Paynow documentation. If one exists for Advanced Integration
   merchants, please point us to it. If it does not exist in Zimbabwe, please
   confirm that, so we do not keep looking.

10. STATUS DELIVERY — resulturl vs pollurl  ← the second important one
    Our resulturl is:
    https://bid-blitz-ten.vercel.app/api/payments/webhook

    It answers the GET reachability probe with HTTP 200 (we observe Paynow
    probing it at initiation). However, across eight test-mode payment
    initiations, Paynow recorded the final status on its side every time and
    has never POSTed a status update to our resulturl. Not one POST has been
    received.

    The same payment's signed status message IS available and verifiable at the
    pollurl returned by initiatetransaction. We can fetch it, and our SHA-512
    hash verification accepts Paynow's real signature on the first attempt.

    a) Why is the status update not being POSTed to our resulturl?
    b) Is there a setting on the integration that must be enabled for
       resulturl delivery?
    c) Does resulturl require a publicly reachable HTTPS URL with a
       certificate Paynow accepts, and is ours acceptable?
    d) Does Paynow only deliver status updates under certain conditions — for
       example only for live-mode transactions, only for certain payment
       methods, or only after the merchant has been verified?
    e) Is there a Paynow-side log of attempted resulturl deliveries that you
       could check against our integration?

    Until we understand this we cannot treat resulturl as working, so we are
    treating pollurl as a required reconciliation path rather than a
    convenience.

11. "SET LIVE"
    What does Paynow require from a merchant before an Advanced Integration
    can be moved from test mode to live? Specifically:
    a) The full checklist of requirements.
    b) Whether "Generate New Key" is required at that point (we understand it
       invalidates any other key held — we want to be deliberate about it).
    c) Whether merchant verification (the KYC/"Verified Merchant" process) must
       be complete before going live, and whether it must be complete before
       the marketplace model in point 5 is permitted.
    d) Whether going live changes the settlement timing we should expect.

We are not asking you to change anything on our integration in this message —
we are asking for the rules so we can build correctly. If any of the above is
better handled by phone or by a formal application, please tell us and we will
take it that way.

Thank you,

BidBlitz
https://bid-blitz-ten.vercel.app
```

---

## 3. What is deliberately not in the message

| Not included | Why |
| --- | --- |
| Paynow Integration Key | Secret. Never sent, never logged, never committed. |
| Paynow merchant password / PIN | Secret, and it must be typed only by the account holder. |
| Any Supabase key | Unrelated to Paynow, and a secret. |
| A request to "enable" payouts or bypass limits | Not ours to ask for. |
| Any claim that the integration is approved | It is not. |
| Any claim that `resulturl` works | It has never delivered a POST. |
| A deadline or threat to move provider | Empty and unhelpful. |

If Paynow's support agent asks for merchant authentication, **stop and enter it
personally** into Paynow's own page. It does not go into this thread, a
screenshot, a commit, or a chat window.

---

## 4. Facts the message relies on, and where they come from

| Claim in the message | Source |
| --- | --- |
| `resulturl` is `…/api/payments/webhook` and answers the GET probe with 200 | Observed in production, 2026-09-26 and 2026-09-27 |
| Eight test-mode initiations, zero `resulturl` POSTs | ADR-011, *Test-mode verification* and *Reconciliation proof* |
| `pollurl` returns a signed message our SHA-512 verification accepts on first attempt | Same |
| Hash scheme, status vocabulary, refund endpoint caveat | Paynow Developer Hub, read 2026-09-26 (ADR-011) |
| No split-settlement API in Paynow Zimbabwe | Paynow documentation read 2026-09-26; only Paynow *Poland* publishes `transfers[]` |
| Merchant onboarding / "Set Live" / key regeneration steps | Paynow merchant documentation, read 2026-09-26 |

---

## 5. After sending

1. Record the date sent, the channel, and the ticket reference in
   `docs/POST_LAUNCH_BACKLOG.md`.
2. **Do not edit this document to imply a reply exists.** When Paynow answers,
   add a new dated section quoting what they actually said, and only then.
3. Point 5 (marketplace permission) is a **BLOCKER** for selling to real buyers
   through this integration. Point 10 is a **BLOCKER** for treating
   `resulturl` as working. Both are recorded in
   `docs/COMPLIANCE_LAUNCH_CHECKLIST.md`.
4. Until both are answered in writing, BidBlitz's honest payment capability is:
   *verified as a receiver, a state machine and a reconciler, in test mode*.
