# BidBlitz indexing and payment audit — 27 October 2026

## Findings and fixes

- The BidBlitz Supabase project `zteakuiuvcikwpnkgxsn` was already `ACTIVE_HEALTHY`. SQL and the public app respond; no restart or unrelated project restore was needed.
- All 17 URLs in the deployed sitemap resolved successfully, but Vercel permanently redirected the bare domain to `www.bidblitz.co.zw` while the sitemap and canonical tags named the bare domain. Public metadata, structured data, robots, sitemap and sharing now name the final www origin. Existing registered authentication and payment callback addresses retain their configured application origin.
- Every auction breadcrumb was missing `@type: ListItem`, matching Google's critical `itemListElement` error. Each breadcrumb now includes the required type. Ratings, reviews, shipping promises and product identifiers are not invented to satisfy optional Google recommendations.
- Known legacy public hosts redirect permanently to the final public origin and preserve paths and query strings. Missing resources keep real noindexed 404 responses; they are not redirected to the homepage. A router-level generic `Page not found` title is accepted alongside a resource-specific title because Next may discard rewrite-only headers.
- The existing checkout reuse check was not atomic: two server requests could both create an external payment page before either recorded it. `claim_payment_checkout` now locks the sale and reserves the initiation before contacting a provider. A saved session is resumable; an initiation without a saved result remains held instead of creating another payable session. Expired sales and provider switching are rejected by the database.
- Checkout errors no longer promise that nothing was charged when a network or provider result is unknown.
- The read-only Playwright mode restricts selection to the release, indexing and 404 suites. It does not require a privileged fixture cleanup token; mutation suites retain their existing cleanup workflow.

## Payment records and external evidence

Live controls at the audit: buyer checkout **paused**, automatic seller payouts **disabled**, direct Linkwa payout instructions **disabled**. No charge, payout, refund, reversal or transfer was performed during this work.

The two production-related collections under investigation remain recorded internally as:

| Collection reference | Gross USD | Fee USD | Seller proceeds USD |
| --- | ---: | ---: | ---: |
| `8DOHPCNH` | 1.00 | 0.05 | 0.95 |
| `S8RKNN8J` | 1.20 | 0.06 | 1.14 |

The USD 1.14 seller payout `5bb9bd1e-dfc8-4813-a9c5-6a6a56d267ce` remains `PAYOUT_DUE` without a provider reference. It must not be resent without provider reconciliation. The USD 0.95 payout remains `DELIVERY_CONFIRMED` without a payout reference. Existing sandbox and Paynow test records are historical fixtures, not evidence of production settlement.

Linkwa's 22 October support reply announces Global Linkwa Balance, available/pending balances by channel, and broader transaction history. It does **not** identify settlement references or resolve these two collections. The public Developer API still documents app-scoped `/balance` and `/statement`; an empty app balance is not proof that all merchant channels or SmileCash received no funds.

Production Linkwa credential presence was verified in Vercel metadata. Its sensitive API key cannot be retrieved through the connector, so this audit does not claim a fresh authenticated production API response. The existing authenticated `/admin/finance/readiness` page performs a read-only provider check with the deployed credentials. Vercel runtime-log access also requires team authorization.

## Verification

The checkout migration was exercised in a rolled-back database transaction before application, then checked again afterward. Checks cover first initiation, duplicate hold, saved-session resumption, provider-switch rejection, expired deadline, wrong buyer, RLS and execution grants. The function is `SECURITY INVOKER`; anonymous and ordinary authenticated clients cannot execute it or read/write the reservation table. Verification left zero fixtures and zero live checkout reservations.

Security advisors introduce no new elevated function warning. The reservation table's RLS-without-policies information notice is intentional: it is accessible only to the server service role.

Google must recrawl the corrected pages before Search Console reports recover. The emails do not contain individual excluded 404 URL examples, so this audit does not claim that every URL in Google's historical report should exist or be indexed.

Sources: [Google breadcrumb specification](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb), [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Linkwa Developer API documentation](https://linkwa.co.zw/developer-apps/docs), connected provider email and live project/database observations.
