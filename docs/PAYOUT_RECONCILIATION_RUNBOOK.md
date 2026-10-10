# BidBlitz Finance Operations — Safe Runbook (2026-10-10)

**Purpose:** Operator guide for reconciling buyer payments and seller proceeds without ever confusing accounting with actual provider settlement. This is an operational checklist, not legal or accounting advice.

## Financial definitions

- **Buyer gross** = agreed auction winning amount (USD minor units).
- **BidBlitz fee** = fee frozen on the transaction (currently 500 basis points / 5%; see live `fee_settings`). Do not recalculate historical fees from current configuration.
- **Seller liability** = gross minus fee, frozen as `net_minor` on the transaction and `amount_minor` in the payout row.
- **Payment intent** = checkout instruction, not proof of payment.
- **PAID/SETTLED transaction status** = BidBlitz recorded authenticated provider payment state; reconcile collections to provider statement and actual settlement account independently.
- **PAYOUT_PENDING** = handover confirmed/ready to attempt seller disbursement subject to provider funds, linked wallet and no disputes.
- **PAYOUT_DUE** = provider-sensitive. The instruction *might already have been sent*. **Do not resend**. A provider reference can be attached by the service-only receipt function after a successful POST; no reference is NOT proof that nothing moved.
- **PAID_OUT** = terminal internal payout record. For legacy payouts the old release handler may have marked PAID_OUT when the provider acknowledged the POST; independently verify destination receipt before treating historical entries as financially settled.

## Owner and finance employee workflow

1. Open **Finance → Payment ledger**. Confirm the buyer's transaction status, provider reference and the frozen equation `gross = fee + seller`. A balanced equation does *not* prove cash receipt.
2. Open **Finance → Seller payout desk**. Triage in order: PAYOUT_DUE, open dispute/HELD, eligible pending, completed.
3. Confirm buyer handover, seller wallet readiness and transaction status. All three are prerequisites but never sufficient alone.
4. Click **Read provider statement** for a read-only, single-page USD statement. Exact ID matches provide a lead, not final proof. A missing reference does **not** mean a payment failed, because only one page was fetched.
5. If Linkwa shows no available settlement balance, **do not instruct a payout**. Locate the actual settlement destination with Linkwa and SmileCash; collections and wallet transfers can use separate balances.
6. For a payout still eligible and when payments have been explicitly enabled after legal/provider acceptance, the owner may click **Instruct Linkwa payout** once. The server checks the live switch, linked wallet, handover, disputes, provider balance, and takes an exclusive claim before sending money.
7. A successful provider POST records the reference while status remains **PAYOUT_DUE** (under reconciliation). Do **not** mark seller paid based on this POST.
8. Verify the actual external seller transfer through provider statement and wallet receipt. Use the owner-only manual status attestation with the exact verified reference and documented evidence. Do not invent a reference.
9. On any timeout, unexpected HTTP response, database write problem, payout without reference or duplicate possibility: stop and escalate to Linkwa/provider, retaining the payout claim and audit trail. Never auto-retry a PAYOUT_DUE payout.

## Mandatory transaction safety

- Every money movement must be idempotent or protected by an exclusive claim. The provider currently does not document a payout idempotency key or status endpoint, so never retry an uncertain POST.
- Disputes block seller payout; account suspension and listing moderation must not fabricate payment or refund events.
- Payments remain disabled until Zimbabwe marketplace custody/payout compliance and Linkwa settlement terms have been verified by the business.
- Owner and ADMIN remain the only staff roles with manual status mutation through the legacy admin RPC. FINANCE_VIEWER and MARKETING roles never receive payout permission.
- Sensitive staff permissions are live database assignments and remain audited. A staff role shown in the UI is not itself authorization.
- No automatic refunds are implemented; provider capability and formal refund authorization remain open items.
- Never share Linkwa private API keys, wallet IDs, unmasked phone numbers, or customer financial event payloads with a marketing employee.

## Known live exceptions to inspect

- At least one historical payout was recorded PAID_OUT following a sandbox provider instruction. Independently verify actual seller-wallet receipt; the ledger alone is not proof.
- A PAYOUT_DUE record currently has no provider reference. Its outcome is ambiguous: do not retry until provider and wallet statements have been reconciled.
- The Linkwa balance can be zero even when WhatsApp notifications report payments. Find the actual payout/settlement account before assuming funds are missing.
- Only one USD statement page is exposed in the payout desk. For comprehensive reconciliation, ask Linkwa for the full statement/settlement report.

## Developer sign-off before enabling real payments

The release gate is **not** the success of automated tests alone. Confirm separately:
1. Company/KYC and all applicable Zimbabwe regulatory/contractual requirements signed off by the operator.
2. Linkwa production API key, webhook, settlement account, seller-wallet linking and fee payer confirmed.
3. A controlled low-value test with distinct buyer, seller and platform accounts; frozen 5%/95% correct.
4. Provider statement shows collection settlement; seller wallet confirms exact proceeds; platform fee ends in the intended account.
5. No unresolved PAYOUT_DUE incidents, and dispute hold and concurrent payout protections verified.
6. Evidence archived privately and reviewed by the owner/finance approver.
7. Only then deliberately flip the payment kill switch through existing approved procedures.

## Team roles in this release

- MARKETING: access to campaign-link creation; no promotion-pricing or financial permissions.
- DISPUTES: dispute review and escalation, no payout release.
- FINANCE_VIEWER: read-only finance operations and provider statement; no provider instruction, status transition or refund.
- TRUST_SAFETY: reports and safety visibility, no payout release.
- OWNER/ADMIN: existing privileged workflows, subject to unchanged DB and transaction safeguards.

Do not assume staff departments imply all future action workflows are implemented. Further owner-only/admin-only RPC migrations are required before listing reviewers and finance operators can independently complete every action.


## High-value double authorization (October 2026)

- Seller transfers of **USD $100 or more** are blocked by a database trigger before the application can create a `PAYOUT_DUE` provider claim or record `PAID_OUT` unless a matching approved request exists.
- An authorized staff member must request approval in **Finance → Seller payout desk** with a specific reason. A **different** active authorized finance reviewer must record the independent approval and evidence note. Self-review is prohibited.
- The buyer and seller in the underlying transaction may not be either approver, even if they hold staff roles.
- Reviews that were valid but later lose their relevant staff permissions do **not** satisfy the live gate. Holds, disputes and fulfillment restarts invalidate approval.
- A finance approval is **not a payment instruction** and does **not prove receipt**; the existing payment kill switch, dispute checks, Linkwa balance verification and provider-side reconciliation still apply.
- The initial threshold is **$100.00 USD (10,000 cents)**. It is intentionally conservative. Changing it requires a migration, reviewed tests, and documented finance policy.
- Existing payments and historical completed payouts were left intact; this policy applies to future state transitions and does not retroactively claim old payouts were vetted.


## EcoCash and SmileCash settlement when Linkwa Developer balance is zero

Buyer collection through Linkwa does **not** automatically split 5% to BidBlitz and 95% into a seller wallet. The transaction records the gross, the frozen platform fee and the seller's exact liability. Cash may settle into the merchant's SmileCash wallet even when the Linkwa Developer API's available USD balance is zero. It is unsafe to assume the Developer balance represents the SmileCash wallet.

### Two actual payout routes

**Route A — Linkwa Developer API:** Only for confirmed buyer handovers, undisputed PAID/SETTLED transactions, enrolled seller wallets and sufficient Developer available USD. Finance can explicitly instruct Linkwa using the protected payout flow. When the provider accepts the instruction, the payout remains PAYOUT_DUE until the seller's actual wallet receipt is verified. Retrying PAYOUT_DUE is forbidden, even if no reference exists.

**Route B — External EcoCash / SmileCash wallet transfer:** Finance opens the payout desk and reserves the seller's frozen **95%** using the **Reserve external payout** action. The database snapshots the seller's registered phone, transfer rail and amount. This reservation blocks a competing Linkwa API disbursement at the SQL state-change boundary, even if the cron read a stale status. The platform does **not** send wallet money itself. An authorized operator transfers that exact amount through SmileCash/ZIPIT/EcoCash, keeps the actual provider transaction reference, and obtains evidence that the seller received it. An authorized payout-recording employee then confirms receipt with the exact reference and a written evidence note. The database atomically closes the payout as PAID_OUT, prevents duplicate transfer references, and records an audit event.

- Do not claim a transfer was sent merely because the reservation was saved.
- Do not type a made-up payment reference. The server verifies authorization but can only trust truthful external receipt evidence supplied by the operator.
- Never reserve an existing PAYOUT_DUE transaction or one with historical provider attempts.
- Do not cancel a reservation if a transfer was sent or its outcome is unknown. Cancel requires an explicit attestation that **no transfer was sent**.
- Existing payouts that were already recorded PAID_OUT or have an unknown provider outcome remain untouched. They require reconciliation, not replay.

### Separate financial kill switches

`payment_settings.payments_enabled`: permits buyer checkout and manual eligible seller payout instructions; owner may deactivate the entire payment system when necessary.

`payment_settings.automatic_payouts_enabled`: defaults to **false**. The recurring settlement cron will not automatically initiate Linkwa seller payouts while false, even if buyer checkout is live. Owner-authorized staff can still deliberately initiate an eligible Linkwa payout from Finance, or reserve an external transfer. Enable automatic payouts only after developer-wallet funding and verified wallet delivery have been demonstrated with distinct buyer and seller accounts. This prevents older ready-for-payout records from unexpectedly sending funds as soon as checkout goes live.

For every sale, gross = frozen fee + frozen seller proceeds. The 5% is BidBlitz's book revenue **before provider charges and taxes**, not cash automatically settled into a separate company account. Do not spend seller liabilities as company funds.
