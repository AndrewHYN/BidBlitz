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
