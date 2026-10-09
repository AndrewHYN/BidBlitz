# Linkwa production activation checkpoint — 9 October 2026

The user verified the replacement production app's balance endpoint in Postman: HTTP 200 with `{"balances":[]}`. After the credentials were updated and redeployed, Finance stopped displaying the HTTP 401 error. An empty list must be shown as a successful connection with no balance entries, never as evidence of zero funds or payout readiness.

## Implementation and validation

Finance now distinguishes an empty successful response, a successful response without USD, an explicit zero USD balance, and a provider error. Tests preserve exact available/pending amounts and reject malformed responses. No payment, payout, recipient, fee or database state is changed by this fix.

The existing webhook verifies the raw-body signature before reading payment fields or touching the ledger. The payout flow refuses release if no available USD balance covers the frozen seller proceeds. Neither control is relaxed. Full unit tests, lint, TypeScript and the production build pass at this checkpoint. Fresh mobile/desktop Playwright remains blocked by the unavailable browser executable and previously failed browser download.

## Manual production proof still required

1. In the replacement Linkwa production app, confirm the webhook URL is `https://www.bidblitz.co.zw/api/payments/webhook`, and that its signing secret matches Vercel Production `LINKWA_WEBHOOK_SECRET`. Never paste either secret in chat or email. Reachability alone does not prove signing or payment delivery. If the provider offers a safe webhook test, inspect the delivery result; otherwise observe the actual supervised payment delivery.
2. Confirm with Linkwa whether the existing recipient/user/wallet IDs are usable by the replacement app. BidBlitz stores provider IDs without an app association, so an old READY flag alone does not prove readiness for this app. If relinking is required, the seller should connect their existing SmileCash wallet in Settings → Payouts, using their own accurate details. Do not create another identity or erase historical recipients/payout references.
3. Arrange two distinct actual participants and agree a small permitted sale amount and total provider charges. Do not pay a sandbox/historical transaction or reuse its payout. Keep payments paused until the supervised test is ready; enabling the current switch enables general checkout, so the operator must supervise the window and pause again if proof fails.
4. Verify provider-confirmed payment, exact frozen 5% fee/95% seller proceeds, and no payout before buyer-confirmed handover. Confirm no open dispute before release. Card funds may remain pending; never treat pending funds as available.
5. After real handover, the buyer confirms it. Observe the application payout flow and use any admin fallback only after reviewing the current payout state and provider ledger. Normal release may be attempted by the application; do not instruct a second payout blindly. Prove exactly one provider payout reference, actual seller receipt and local PAID_OUT reconciliation.
6. Enable payments generally only after the complete collection, signed webhook, handover and payout proof passes. Preserve payment pause, dispute and duplicate guards throughout debugging. No automatic refund behavior is added.

The historical sandbox payout is not production proof. Migrating to a new provider app does not establish that old balances, payment links, webhook retries or recipient IDs moved with it; unresolved historical transactions require provider clarification before any manual retry.
