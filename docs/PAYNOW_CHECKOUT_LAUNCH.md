# BidBlitz — Paynow collection, internal ledger and manual seller settlement

Updated 2026-10-11. This runbook is a technical design and release checklist, **not** proof of merchant activation or cash settlement.

## Product contract

* The buyer wins an auction and pays the exact immutable `transactions.gross_minor` in USD at Paynow-hosted checkout.
* Paynow collects the payment and settles to the **Paynow merchant's configured settlement account** under its own terms. Paynow is not our seller payout desk.
* BidBlitz stores the gross amount, its immutable 5% commission, the seller's 95% liability, the provider references and the payment status. Platform commission is gross revenue **before gateway charges**; finance separately records gateway fees and company expenses.
* A checkout return, WhatsApp/SMS receipt, or Paynow payment-page opening **must never mark a sale PAID**. Accept only an authenticated provider callback or a server-to-server hash-verified Paynow status poll.
* The seller liability is disbursed only after verified handover, no open dispute, settlement evidence, staff authorization, and the payout desk's duplicate guards. Never automatically retry an unknown-outcome transfer.
* For amounts $100 or more, retain the existing two-person approval control.

## Why not a simple Email Payment Request or static Payment Button?

Paynow's *Simple Payment Request Button* can encode merchant email, amount, merchant reference and a locked flag, but their documentation explicitly warns the customer can still alter amount/reference, even if locked. Such links are useful for individually reconciled manual invoicing, not for automatically crediting arbitrary auction transactions. Do not use a generic payment button as evidence of payment or wire it directly to `mark_transaction_paid`.

The existing `src/server/payments/paynow.ts` is more appropriate: signed initiate response; stored payment URL + poll URL; SHA-512 verified callbacks/status responses; exact-cent/UUID validation; an idempotent Postgres ledger. The checkout UX can remain one **Pay with Paynow** button.

## Repository implementation pointers

* `src/server/payments/config.ts` — credential-driven provider adapter selection. `PAYMENT_PROVIDER=paynow` selects Paynow **for new checkout**, even when Linkwa keys are present; `auto` retains legacy Linkwa-first selection. Missing/partial credentials fail closed.
* `src/app/api/payments/checkout/route.ts` — authenticated winner-only checkout. An unpaid sale with a previously stored Linkwa intent cannot start a new Paynow payment. It must be reconciled first.
* `src/app/api/payments/webhook/route.ts` — accepts both JSON (Linkwa) and form-encoded (Paynow), routing to the corresponding independently configured signature verifier. The encoding is only a routing hint, not proof of origin. Historical Linkwa callback signing keys may be needed for callbacks from deleted/rotated apps; avoid deleting remaining app credentials.
* `src/server/payments/paynow.ts` — retries reopen an existing Paynow session instead of creating another transaction. If the signed Paynow initiate response lacks a valid payment or poll URL, refuse to redirect the buyer.
* `src/app/api/payments/reconcile/route.ts` — server-side Paynow poll for a specific pending sale; this is a fallback to callbacks.
* `src/server/payments/ledger.ts` — exclusive database path for authenticated money-state transitions.
* `src/app/admin/finance/payments/page.tsx` — buyer collection, fee and seller-liability ledger.
* `src/app/admin/finance/payouts/page.tsx` — manual wallet transfer reservation, staff controls and provider evidence.
* `src/server/payments/runtime.ts` — independent flags for buyer checkout, auto payout and direct Linkwa payout instructions.

## Critical currency mismatch observed

A Paynow email on 5 October 2026 labeled transaction reference `7d6e7d05-cf41-475c-80b3-5dc17b840223` / provider reference `64017577` as **ZWG 0.50 (TESTING: Faked Success)**, while the production BidBlitz ledger recorded that same transaction as **USD 0.50 PAID**. No real funds moved in Paynow test mode and the database has no related seller payout record. Preserve this discrepancy for forensic reconciliation and do not count it as a genuine USD sale.

The standard Paynow initiation/status API does not explicitly carry a currency field. The merchant payment-method configuration determines currency, so `PAYNOW_INTEGRATION_CURRENCY=USD` is required as a **manual attestation** after verifying the exact Paynow integration is configured for USD. This app-side guard does NOT prove the provider's configuration; merchant verification and an actual USD settlement are still necessary.

## Safest setup

1. Sign in to the Paynow merchant account. Confirm the account is controlled by BidBlitz and the settlement bank destination is suitable for holding marketplace seller proceeds. Do not use a third party's merchant credentials as though they were BidBlitz's.
2. In Paynow **Other Ways To Get Paid → Create/Manage Shopping Carts → Create Advanced Integration**, create a new merchant integration in test mode, with selected payment methods. Copy Integration ID and request the secret Integration Key by Paynow's secure delivery method. Keep the key out of source code, email threads and browser bundles. See [official integration setup](https://developers.paynow.co.zw/docs/paynow/integration_generation/).
3. Verify that the Preview environment and its database contain **non-production test transactions only** before doing simulated Paynow test payments. A Paynow test-mode confirmation can still mark rows paid in whichever Supabase database Preview points to.
4. In Vercel Preview only, configure `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY`, verified `PAYNOW_INTEGRATION_CURRENCY=USD`, and `PAYMENT_PROVIDER=paynow`. Do not set the attestation for the historically ZWG-labelled integration until Paynow confirms it is USD. Do not remove the old `LINKWA_*` secrets while pending historical Linkwa payments need reconciliation.
5. Run unit/type/lint/build and desktop/mobile release smoke. Verify signed callback, polling, repeat clicks, different-provider collision, altered amount/reference, invalid signature, duplicate events, interruptions and insufficient funds. Paynow test-mode payments move **no real funds**. Read [official test mode](https://developers.paynow.co.zw/docs/paynow/test_mode/).
6. On completion, Paynow says a merchant can request to **Set Live**; settle banking/commercial approval and verify applicable fees before moving live. Rotate the test key when moving live and set production keys through Vercel (never GitHub).
7. Before activating buyer checkout in production, prove one controlled transaction all the way through Paynow confirmed payment, provider statement, merchant settlement account, seller payout reservation and recipient confirmation, plus fee reconciliation. Do not infer settlement from Paynow's Paid status alone.
8. Keep `automatic_payouts_enabled=false` and `linkwa_payout_instructions_enabled=false` until there is a separately reviewed payout launch. Do not enable automatic seller transfers as a side effect of switching buyer checkout.

## Live incident and operational constraints, 11 Oct 2026

Two Linkwa WhatsApp collection notifications (US$1.00 and US$1.20) are not reflected in the SmileCash USSD balance (US$0.00) or the current Linkwa dashboard. The old Linkwa developer app was deleted. Linkwa Support requested a call instead of providing a settlement ledger. A support case with four screenshots has been sent. Preserve all historical references, signed receipts, notifications and remaining app keys.

At the last read-only inspection, `payment_settings` reported `payments_enabled=true`, `automatic_payouts_enabled=false` and `linkwa_payout_instructions_enabled=false`. These are **database values**, not proof a gateway can currently settle money. Explicitly review the buyer switch before any live testing.

## Release cannot be called live until

- [ ] Paynow merchant owner and settlement bank destination verified
- [ ] Merchant terms permit BidBlitz's marketplace collection/hold/disbursement model
- [ ] Production integration ID and key securely configured
- [ ] Test-mode callbacks and status polling verified with an isolated test ledger
- [ ] Signed Paynow status and actual merchant settlement reconciled
- [ ] Manual seller payout including two-approver threshold and duplicate guards verified
- [ ] Public checkout tested on production in a deliberately controlled transaction
- [ ] Linkwa unresolved historical funds remain under a separate reconciliation case

## Official documentation

- [Paynow merchant integration setup](https://developers.paynow.co.zw/docs/paynow/integration_generation/)
- [Initiate transaction](https://developers.paynow.co.zw/docs/paynow/initiate_transaction/)
- [Status update](https://developers.paynow.co.zw/docs/paynow/status_update/)
- [Simple payment request button limitations](https://developers.paynow.co.zw/docs/paynow/simple_paynow_request_button/)
