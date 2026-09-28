# Compliance launch checklist

**This is a checklist, not a compliance claim.** Nothing ticked here has been
verified by a lawyer, an accountant or a regulator. BidBlitz has not been
audited against any data-protection, tax or payments regime, and this document
must never be quoted as evidence that it has.

Two rules govern the whole file:

1. **Do not invent a requirement.** Where a threshold, deadline, registration
   number, authority or obligation is not confirmed, it is written as an open
   question with an owner. A specific-but-wrong legal claim in a launch
   document is worse than an honest blank.
2. **Do not invent a fact.** No registration number, entity name, address, tax
   number, licence, office bearer or Paynow approval appears anywhere in this
   repository, because none has been supplied. See
   `docs/INTERNAL_LAUNCH_CHECKLIST.md`.

Status key: ☐ not started · ◐ in progress · ☑ done and evidenced

---

## 0. BLOCKER — nobody can sign up until a mailer is configured

**Verified 2026-09-28 against this Supabase project's own Auth configuration.**

| Setting | Value |
| --- | --- |
| Custom SMTP provider configured | **No** — the built-in Supabase email service is in use |
| `rate_limit_email_sent` | **2 per hour, project-wide** |
| `mailer_autoconfirm` | `false` (email confirmation is ON, and must stay ON) |

A signup on BidBlitz sends a confirmation email. With no custom SMTP, the whole
platform shares a budget of **two confirmation emails per hour**. The moment a
real user and the test suite together exceed two signups in an hour, GoTrue
refuses every subsequent signup with `over_email_send_rate_limit`.

**This is the cause of the real user who was told "Too many attempts. Try again
later."** It is not a BidBlitz rate limit — BidBlitz's own limiter allows 5
failed attempts per IP+email per minute, and a real user's first attempt never
came close to it.

**What was a BidBlitz bug, and is fixed:** the application was translating that
provider refusal into *its own* limiter's wording, and was additionally
charging it against BidBlitz's failure budget. So the user was told the site was
blocking them when the site had not blocked anything, and each retry made the
window worse. The provider throttle is now reported in its own words, in its own
right, and no longer spends any of BidBlitz's budget.

**What only the owner can fix:** configure a real SMTP provider in Supabase
(*Project Settings → Authentication → Email*), which is what raises the send
limit to something a marketplace can use. That needs the owner's own email
provider account and credentials.

☐ **0.1. Choose a transactional email provider** and create an account.

☐ **0.2. Add its SMTP host, port, username and password to Supabase Auth.**
Store them in Supabase — never in this repository, never in `.env.example`,
never in a support message.

☐ **0.3. Set a correct "from" sender** and verify SPF/DKIM for the sending
domain, or mail will be filtered rather than delivered.

☐ **0.4. Confirm `rate_limit_email_sent` is raised** to a level that survives a
launch. Read the value back after configuring SMTP — do not assume it moved.

☐ **0.5. Prove a signup end to end** on a real disposable mailbox: signup →
email arrives → link works → sign in. The Playwright signup test currently
*skips itself* with the provider-throttle message, which is honest but is not a
passing signup.

☐ **0.6. Decide what to tell users** who tried to sign up while the budget was
exhausted. None of them were created, so there is nothing to clean up, but the
failure was visible to them.

**Until 0.2 and 0.4 are done, BidBlitz cannot onboard a real user**, and no
amount of application code changes that.

---

---

## A. Data controller — who is responsible for the data

BidBlitz holds personal data about real people: names, email addresses,
phone numbers, profile photos, locations, listing text and photographs, bids,
messages, transaction records, review text, reports, device and session data,
and notification preferences.

☐ **A1. Confirm the data controller.** Who is the controller — the legal
entity, or an individual? (Blocked on `INTERNAL_LAUNCH_CHECKLIST.md` A1–A8.)

☐ **A2. Confirm the applicable regime.** The Zimbabwean framework administered
by POTRAZ and any obligations that attach to processing outside Zimbabwe.
**This has not been researched in this repository and must be confirmed with a
lawyer or with POTRAZ directly.** No obligation is asserted here.

☐ **A3. Confirm whether any registration, notification or licensing step is
required**, and complete it.

☐ **A4. Name a data protection contact** for users to reach. The site currently
publishes a phone number and an email address (`/terms`, footer) but does not
name a data-protection role.

**Consequence if unresolved:** processing personal data of real users without a
determined controller or a published contact is the first thing to fix. It does
not depend on payments being live.

---

## B. Data protection officer

☐ **B1. Determine whether a DPO is required** under the applicable regime, for
the size and nature of the processing.

☐ **B2. If required: appoint one in writing**, publish the contact route, and
record the appointment.

☐ **B3. If not required: record the reasoning**, so the decision is auditable
rather than silent.

**Note on what BidBlitz does process:** identity data (name, email), contact
data (phone, location), financial transaction records, and content users
create. Payment card data is **not** stored by BidBlitz — it is entered on
Paynow's hosted page and Paynow is the controller of it. That distinction should
be stated in the privacy policy and is currently not, in those words.

---

## C. Privacy policy review

☐ **C1. Review `/privacy` against actual behaviour.** Confirm every statement
in it is true today. Particular points to verify:

- [ ] Does it state that BidBlitz is the controller, and name it?
- [ ] Does it list the actual categories of data held, including transaction
      and payout records?
- [ ] Does it name the processors — currently **Supabase** (database, auth,
      storage, realtime) and **Vercel** (hosting) — and where they process?
- [ ] Does it mention Paynow as a recipient of buyer payment data?
- [ ] Does it state the retention period for each category? (No retention job
      exists in the codebase today.)
- [ ] Does it describe the right to access, correct, delete or export, and how
      to exercise it?
- [ ] Does it say what happens to a transaction record if a user asks for
      deletion? **A financial record may need to be retained even if the
      profile is deleted** — that tension is not addressed anywhere yet.

☐ **C2. Add a data-processing summary** to the internal record, not only to
the public page.

☐ **C3. Confirm cookie/consent position** for the analytics and storage
features actually in use. No analytics tool is currently installed, which
simplifies this — keep it that way until the choice is made deliberately.

---

## D. Cross-border processing

BidBlitz uses managed services whose infrastructure locations are not chosen by
this project.

☐ **D1. Establish where Supabase processes and stores data** for this project
(the region chosen when the project was created). Document it.

☐ **D2. Establish where Vercel runs this deployment** and whether any function
executes in a different region.

☐ **D3. Confirm whether data leaving Zimbabwe requires any specific safeguard,
notification or contract** under the applicable regime. **Not researched in this
repository. Must be confirmed.**

☐ **D4. Document the onward recipients of buyer payment data**: Paynow receives
the payment instruction and the buyer's payment details. Record that explicitly
rather than relying on the provider's own privacy policy.

---

## E. Retention

☐ **E1. Decide and write down a retention period for each category:**

| Category | Current state | Decision needed |
| --- | --- | --- |
| Accounts and profiles | Retained indefinitely | |
| Listings, bids, transactions | Retained indefinitely | |
| `seller_payouts` / `seller_payout_events` | Retained indefinitely | |
| `payment_events` (payment audit) | Retained indefinitely | |
| Reviews, reports, notifications | Retained indefinitely | |
| Uploaded photographs | Retained with the listing | |
| Deleted-account residue | **No purge job exists** | |

☐ **E2. Implement the retention job** once E1 is decided. Nothing in the
codebase currently deletes anything on a schedule.

☐ **E3. Confirm the financial-record retention requirement** with an
accountant — this drives whether transaction and payout records can ever be
purged. (`INTERNAL_LAUNCH_CHECKLIST.md` B7.)

---

## F. Data subject requests

☐ **F1. Publish a route** for access, correction, export and deletion requests.
The site's contact details exist; a documented process does not.

☐ **F2. Define what is actually possible today, and document it honestly:**

- *Access / export* — possible: the data is in Postgres and can be read.
- *Correction* — possible for profile fields, with limits.
- *Deletion* — **not fully possible.** `profiles`, `transactions`,
  `seller_payouts` and `payment_events` have `on delete restrict` /
  `on delete set null` relationships to user rows by design, because financial
  records must not vanish with an account. A deletion request may therefore be
  answered with anonymisation rather than deletion, and the user must be told
  that in advance.
- *Erasure of a live auction* — impossible; bids and prices are public record.

☐ **F3. Set an internal turnaround target** and record it. **No legal deadline
is asserted here, because none has been confirmed.**

---

## G. Incident handling

☐ **G1. Name the incident owner** and a deputy.

☐ **G2. Write the response runbook**, covering at minimum:

- a leaked Paynow Integration Key or merchant credential → **rotate
  immediately** in the Paynow dashboard, then in Vercel; the Integration Key is
  a bearer credential for the merchant account
- a leaked Supabase secret key → rotate in the Supabase dashboard, then in
  Vercel
- exposure of personal data → stop the leak, preserve evidence, notify
  controller and (if required) regulator and affected users
- a fraudulent payout or seller account → halt payouts, preserve the audit
  trail in `seller_payout_events`, which is append-only
- a compromised admin account → revoke `profiles.is_admin` immediately; admin
  status is the single flag that grants payout control

☐ **G3. Confirm the notification obligations** that apply, and to whom. **Not
researched in this repository. Must be confirmed.**

☐ **G4. Rehearse it once** before real money is involved. A runbook that has
never been walked is a document, not a plan.

---

## H. Business, tax and accounting records

Detailed blanks are in `docs/INTERNAL_LAUNCH_CHECKLIST.md`. This section is the
checklist; that file is the blank form.

☐ **H1. Legal entity and business registration** — A1–A10. ☒ nothing supplied.

☐ **H2. ZIMRA / TIN registration** — B1. ☒ unknown.

☐ **H3. VAT position and threshold monitoring** — B2, B3. Re-check the
threshold against current ZIMRA guidance **annually and whenever turnover
changes materially**, because turnover is not static and a fixed assumption
becomes wrong silently. ☒ not implemented.

☐ **H4. Accounting setup for five revenue and cost categories.** Each needs its
own treatment, and they are genuinely different things:

| Category | What it is | Status |
| --- | --- | --- |
| **5% platform fee** | BidBlitz's own revenue | Not configured in any accounting system |
| **Paynow charges** | Collected from the buyer, **paid to Paynow** — *not* BidBlitz revenue | Not separately tracked |
| **Seller proceeds** | Held on the seller's behalf, then paid out | Tracked in `seller_payouts`; not exported anywhere |
| **Refunds** | Money returned to buyers | No refund record exists in the product |
| **Dispute losses** | Absorbed by the platform when a refund follows a bad sale | No cost tracking |

☐ **H5. Reconcile the platform fee against the bank, monthly.** The fee is
computed and frozen in the database per transaction; nothing exports it.

☐ **H6. Export the fee ledger** to whatever accounting package is used.

☐ **H7. Confirm the treatment of money held for sellers between settlement and
payout** with an accountant. This is the marketplace-specific question and it
has not been asked yet.

**Hard rule: no tax calculation, reporting or collection is implemented in
BidBlitz, and none will be until H1–H3 and H7 are answered.**

---

## I. Payments — external gates

These are **not** compliance items BidBlitz can close by writing code. They are
dependencies on third parties.

☐ **I1. Paynow marketplace approval — BLOCKER.**
Has Paynow confirmed **in writing** that a merchant may collect buyer funds for
third-party sellers and make onward payments to those sellers in a manual
model? The query is drafted in `docs/PAYNOW_MARKETPLACE_SUPPORT_REQUEST.md`,
point 5. **No response has been received. This is not approved.**

☐ **I2. `resulturl` status delivery — BLOCKER.**
Across eight test-mode initiations Paynow recorded the final status every time
and **never POSTed to `resulturl`**. `pollurl` reconciliation works and is the
proven path, but it is a fallback, not a fix. Query drafted at point 10 of the
same document. **No response has been received.**

☐ **I3. Refund mechanism for an Advanced Integration merchant — BLOCKER for
handling disputes.** No general-purpose refund endpoint is confirmed. Until it
is, refunds are manual and must be recorded by hand.

☐ **I4. Merchant verification status.** Paynow's KYC / "Verified Merchant"
process is separate from opening a test integration and affects settlement
timing. Non-verified accounts settle weekly. **Status unknown.**

☐ **I5. "Set Live" requirements.** Unknown. Do not request it before I1 and I2
are answered.

☐ **I6. Integration Key rotation at the move to live.** A fresh key must be
generated when leaving test mode, which invalidates any other key held. Handle
it deliberately; never let the key enter a commit, a log or a support message.

---

## J. Operational readiness

☐ **J1. Read `docs/MARKETPLACE_OPERATIONS.md`** end to end and confirm someone
is actually named to do each step.

☐ **J2. Name the operator** who performs seller payouts, and a second person
who can do it if they are unavailable.

☐ **J3. Confirm the reconciliation routine has an owner and a schedule.**

☐ **J4. Confirm escalation contacts** exist internally for the fraud and
incident paths in §G and in the operations SOP.

☐ **J5. Note the capacity limit that a real user will hit first.** A brand-new
visitor cannot create an account at all until §0 is closed. This is a support
issue before it is a growth issue: the first person who tries to join a
marketplace and is told to wait is the first person who may never come back.

☐ **J6. There is currently NO administrator.** Verified 2026-09-28: **zero** rows
in `public.profiles` have `is_admin = true`. `/admin` — and with it the entire
payout operations queue — is unreachable by any real person, and has always
been. This must be set deliberately, by the owner, on their own account:

```sql
-- owner runs this in the Supabase SQL editor, for their own account only
update public.profiles set is_admin = true where id = '<your own user id>';
```

Find the id under *Authentication → Users*, or by joining `auth.users` to
`profiles`. Then prove it: sign in, open `/admin`, confirm **Payout operations**
is present. Do not grant admin to a shared or test account, and do not guess —
`is_admin` is the single flag that authorises moving seller money, and it should
belong to a named person who has read `docs/MARKETPLACE_OPERATIONS.md`.

☐ **J7. The payout queue's populated view has not been seen in a browser.**
Verified 2026-09-28: `public.transactions` is **empty** in production, so there
is no paid sale for the queue to render — it shows its empty state. The
mechanics underneath it *are* proven: 25 database checks drive the real
`admin_transition_seller_putation` function over the real PostgREST API with a
real admin session, including the whole fulfilment ladder and the refusals. But
the rendered rows, the confirmation dialog and the reference input should be
looked at on the **first real paid sale**, before an operator is trusted with a
live payout. Do not fabricate a paid transaction to rehearse it.

☐ **J8. Production currently has no listings at all.** Verified 2026-09-28:
`auctions`, `bids`, `transactions`, `auction_images` and the `auction-images`
storage bucket all hold **zero** rows. That is correct — the ten test listings
found there were e2e residue and have been removed (see
`docs/POST_LAUNCH_BACKLOG.md`) — but it means a first-time visitor sees an
empty marketplace. **List real items before opening the doors**, and confirm the
homepage empty state reads as "nothing listed yet" rather than broken.

☐ **J9. Decide where the test suite runs.** The e2e suite publishes real
auctions, uploads real files and places real bids through the real app. It now
cleans up after itself automatically, but cleanup is a safety net, not a
boundary. The correct answer is a separate Supabase project for tests. That
needs an owner action (provision it, set `.env` for the test run) and it is the
only way a test run can never touch production.

☐ **J10. Confirm no QA account is an administrator before launch.** The QA
account password is in the public repository because the suites need it. That
is only safe while none of those accounts can authorise a payout. The database
harness now fails loudly if one is, but the check only runs when someone runs
it. Never promote a `@bidblitz.test` account; rotate before any real account
shares that password.

---

## K. Launch decision

Launch is gated on the following being **closed**, not merely attempted:

| # | Gate | Type | Closed? |
| --- | --- | --- | --- |
| K0 | **Transactional email provider configured and signup proven end to end** | Owner action | ☐ |
| K1 | Legal entity facts supplied and confirmed | Owner action | ☐ |
| K2 | Controller determined, contact published | Owner action | ☐ |
| K3 | Privacy policy reviewed against actual behaviour | Owner action | ☐ |
| K4 | Tax position confirmed, records plan agreed | Owner action | ☐ |
| K5 | **Paynow marketplace model approved in writing** | External — Paynow | ☐ |
| K6 | **`resulturl` delivery understood, or push-to-live accepted as unreliable** | External — Paynow | ☐ |
| K7 | Refund mechanism confirmed or manual refunds accepted | External — Paynow | ☐ |
| K8 | Payout operator and reconciliation owner named | Owner action | ☐ |
| K9 | Incident runbook written and rehearsed | Owner action | ☐ |
| K10 | Paynow moved from test mode to live | External — Paynow | ☐ |
| K11 | **An account actually has `is_admin` — today none does** | Owner action | ☐ |
| K12 | **A transactional email provider is configured AND a signup is proven end to end** | Owner action | ☐ |
| K13 | Real listings exist, so the marketplace is not empty on arrival | Owner action | ☐ |

**K0 is the first gate chronologically.** It is also the cheapest: one SMTP
configuration. Leaving it open means the marketplace has no way to admit a new
participant at all.

**K11 is the gate that surprises people.** The payout machinery is built,
audited and proven, and not one account can reach it.

**K13 is the gate a customer notices first.** With no listings, a visitor lands
on an empty marketplace and concludes it is not a real business.

**BidBlitz is not commercially live until K0–K13 are closed.** A complete
codebase, a passing test suite and a deployed site do not make it live; they
make the software ready for a business that is ready to trade.
