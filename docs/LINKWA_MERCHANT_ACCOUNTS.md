# Linkwa merchant and user account model

Linkwa's current public FAQ describes a single merchant account that can operate multiple businesses. Collections settle to the merchant's linked mobile wallet. Linkwa does not issue deposit accounts for individual platform users. BidBlitz's user accounts must therefore be internal sales ledgers backed by merchant collection and settlement records, rather than invented provider bank or escrow accounts.

Source: https://linkwa.co.zw/faqs and https://linkwa.co.zw/developer-apps/docs, checked 28 October 2026.

## Production API evidence

An owner can queue a short-lived row in `public.payment_provider_checks` and configure its UUID as `PAYMENT_HEALTH_AUDIT_ID` in Production. Next instrumentation atomically claims that row before reading the documented Linkwa balance and one USD statement page with the deployed credentials. Server credentials and customer descriptions are excluded from the recorded result. No public route can request an audit.

The database controls request expiry, claim exclusivity and recording time. Ordinary authenticated and anonymous clients cannot access the audit table or execute its maintenance functions. The service role can update existing requests but cannot create them. A completed request cannot be rerun.

`PASSED` means both documented reads succeeded; `PARTIAL` means one succeeded. Neither is payment or settlement proof. Every audit result explicitly sets `collectionProven: false`, and statement coverage is labelled as one page. Clearing an individual user's proceeds requires evidence tied to the exact sale, currency, amount and settlement reference. Historical ambiguous payouts remain held.

The audit flag is optional. When unset it performs no database or provider work. Provider and database reads are bounded; audit errors do not stop the marketplace from starting.

## Verified production result, 28 October 2026

The deployed production credentials successfully read both endpoints. Exact balances and statement references are preserved in the private audit row. Coverage is one app-scoped statement page, not the merchant's full or global history. This establishes API authorization and the reported balance; it does not establish merchant-wallet settlement or completion of an uncertain seller payout. The audit flag was cleared for the next release.

## User sales accounts and collection proof

Every signed-in user has a sales account at `/dashboard/account`. The database derives that user's USD proceeds from immutable paid transactions; no editable balance or separate provider account is created. Five exclusive buckets reconcile to all recorded proceeds: collection checks, held, ready for finance, under review, and paid to seller. Totals cover every eligible sale, while the page shows the latest 100. Other currencies are explicitly reported for finance review.

Finance staff with `payouts.mark_paid` verify receipts in `/admin/finance/payments`. They must enter the exact collection reference, full gross amount, USD currency, a unique settled merchant receipt/reference, evidence source and note, and affirm actual receipt. This records evidence only. It cannot mark an unpaid transaction paid, confirm handover, send a transfer, or clear a dispute. Receipt and collection references cannot be reused across sales. This initial workflow supports an exact receipt per sale; a combined settlement must be reconciled separately before allocation support is introduced.

Evidence is immutable, private and attributed to the verifying staff member. Public RPC wrappers execute as the caller; narrowly scoped private functions enforce ownership or live staff permissions. No ordinary client can read the evidence tables directly. Both external transfer reservations and new provider payout instructions are blocked by database triggers until the corresponding collection is verified. Existing uncertain provider instructions remain subject to the existing independent seller-receipt reconciliation process and cannot be automatically retried.

A historical collection was positively identified as the documented 5 October sandbox exercise (ADR 016). A Paynow collection was positively identified as **TESTING: Faked Success** in its original merchant email. Those immutable records are retained and classified privately; they are excluded from real user proceeds and cannot clear a live payout. No other record was inferred to be a test.

The finance snapshot excludes those same confirmed test records from paid gross, recorded fees, seller liabilities and payout pipeline totals. The payout desk loads the same collection checks, identifies historical tests, and blocks new transfer controls until merchant receipt verification succeeds. Existing transfer reconciliation remains available. The payment ledger retains every historical record with its test label.

The existing uncertain payout remains under review, and the earlier collection still requires merchant receipt verification. Exact case details remain in the protected finance ledger. No merchant receipt was invented. Checkout, automatic disbursements and Linkwa payout instructions remain disabled pending reconciliation. No charge, payout, refund or transfer was performed during this work.

## Verification

`supabase/tests/user_sales_accounts.sql` creates isolated fixtures and rolls the entire transaction back. It checks anonymous and cross-user denials, staff permissions, wrong amount/currency/reference, required receipt affirmation, unique references, immutable evidence, both payout gates, frozen/disputed funds, historical-test exclusion, and exact account totals beyond the 100-row page. It also exercises the existing seller-receipt proof requirement. The applied migration was tested again against the live database without persisting fixtures.

The application unit suite passes 777 tests. The new sales screen and finance form are server rendered with a small client form boundary; read failures display an unavailable state rather than a zero balance. Existing database advisor warnings are unchanged; the two private evidence tables intentionally have RLS with no client policies. Their only client access is through the permission-checked projections and receipt action.
