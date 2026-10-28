# Linkwa merchant and user account model

Linkwa's current public FAQ describes a single merchant account that can operate multiple businesses. Collections settle to the merchant's linked mobile wallet. Linkwa does not issue deposit accounts for individual platform users. BidBlitz's user accounts must therefore be internal sales ledgers backed by merchant collection and settlement records, rather than invented provider bank or escrow accounts.

Source: https://linkwa.co.zw/faqs and https://linkwa.co.zw/developer-apps/docs, checked 28 October 2026.

## Production API evidence

An owner can queue a short-lived row in `public.payment_provider_checks` and configure its UUID as `PAYMENT_HEALTH_AUDIT_ID` in Production. Next instrumentation atomically claims that row before reading the documented Linkwa balance and one USD statement page with the deployed credentials. Server credentials and customer descriptions are excluded from the recorded result. No public route can request an audit.

The database controls request expiry, claim exclusivity and recording time. Ordinary authenticated and anonymous clients cannot access the audit table or execute its maintenance functions. The service role can update existing requests but cannot create them. A completed request cannot be rerun.

`PASSED` means both documented reads succeeded; `PARTIAL` means one succeeded. Neither is payment or settlement proof. Every audit result explicitly sets `collectionProven: false`, and statement coverage is labelled as one page. Clearing an individual user's proceeds requires evidence tied to the exact sale, currency, amount and settlement reference. Historical ambiguous payouts remain held.

The audit flag is optional. When unset it performs no database or provider work. Provider and database reads are bounded; audit errors do not stop the marketplace from starting.
