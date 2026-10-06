# Internal launch checklist — business facts the owner must supply

**Nothing in this document is invented.** No registration number, legal entity
name, address, tax number, licence, director name or bank detail has been
guessed, and none should be added to any file, page, policy or message until
the owner supplies it.

Why this file exists: several things BidBlitz would need in order to trade
lawfully — and to complete a Paynow merchant application — are not derivable
from the codebase, are not discoverable by an engineer, and cannot be filled in
by an auditor. They are business facts. Until they exist, the product can be
built and tested but cannot be described as a registered, compliant
marketplace.

Each item below is a **blank to fill**, not a value. Owner action required.

Operational counterpart: `docs/GROWTH_PLAN.md` holds the acquisition ladder
(10 sellers / 20 live listings → 25 sellers / 50 listings), the category focus,
the daily founder/operator checklist and the Google discovery status. It
supplies business facts no more than this file does.

---

## A. Legal identity

| # | Fact needed | Value | Supplied by / date |
| --- | --- | --- | --- |
| A1 | Registered legal entity name (as on the certificate of incorporation) | *(not supplied)* | |
| A2 | Entity type (company / sole trader / other) | *(not supplied)* | |
| A3 | Company registration number | *(not supplied)* | |
| A4 | Date of incorporation | *(not supplied)* | |
| A5 | Registered business address | *(not supplied)* | |
| A6 | Operating / trading address, if different | *(not supplied)* | |
| A7 | Country of incorporation | *(not supplied)* | |
| A8 | Directors / office bearers (names and roles) | *(not supplied)* | |
| A9 | Any trading or sector licence the activity requires | *(not supplied — unknown whether one is required)* | |
| A10 | Who is authorised to bind the entity in a Paynow or banking relationship | *(not supplied)* | |

**Blocks:** merchant agreements of any kind, any tax registration, and any
statement on a public page naming a legal entity. It also blocks a Paynow
*merchant application* in the owner's own name — but note that Paynow
marketplace approval itself is **non-blocking for launch** (ADR-016: Linkwa is
the intended launch provider, Paynow the fallback), so this row is not a launch
gate. It becomes one again the moment anyone needs a signed agreement.

---

## B. Tax

| # | Fact needed | Value | Supplied by / date |
| --- | --- | --- | --- |
| B1 | ZIMRA-registered taxpayer number (TIN), if registered | *(not supplied)* | |
| B2 | VAT registration status — registered, or below the registration threshold | *(not supplied)* | |
| B3 | The applicable VAT registration threshold, confirmed against current ZIMRA guidance | *(not known — must be confirmed, not assumed)* | |
| B4 | Which taxes apply to marketplace commission income | *(not known — must be confirmed with an accountant)* | |
| B5 | Which taxes, if any, apply to seller income passing through the platform | *(not known — must be confirmed with an accountant)* | |
| B6 | Whether sellers' tax status needs to be collected, and what that triggers | *(not known — depends on B4/B5)* | |
| B7 | Books and records retention period required for these records | *(not known — must be confirmed)* | |

**Hard rule until B1–B7 are answered: BidBlitz implements no tax calculation,
no tax reporting and no tax collection of any kind.** Adding a VAT or
withholding calculation on a guess would be worse than having none. See
`docs/COMPLIANCE_LAUNCH_CHECKLIST.md` §D for the records that must be kept
regardless.

---

## C. Banking and settlement

| # | Fact needed | Value | Supplied by / date |
| --- | --- | --- | --- |
| C1 | Name of the bank account Paynow settles into | *(not supplied)* | |
| C2 | Whether that account is held in the legal entity's name (A1) | *(not supplied)* | |
| C3 | Who is authorised to instruct a seller payout from it | *(not supplied)* | |
| C4 | Whether a second operational account is needed, and for what | *(not supplied)* | |
| C5 | How seller payment details are verified before a payout is made | *(owner decision — none implemented today)* | |
| C6 | Paynow merchant account email and registered contact | *(not supplied)* | |

**Note on C5:** BidBlitz collects **no** seller bank details today, in the
product or in the database. Payouts are made out of band. Adding a collection
flow — and the storage, security and legal obligations that come with storing
bank details — is a deliberate decision, not a feature to slip in. It is tracked
in `docs/POST_LAUNCH_BACKLOG.md`.

---

## D. Public-facing statements

Every one of these is currently absent from the product and must stay absent
until it is true.

- [ ] The legal entity name and registration number shown on `/terms` and
      `/privacy`
- [ ] A registered business address shown on the site
- [ ] A named contact point and response commitment for disputes
- [ ] Any statement that BidBlitz is a registered marketplace operator
- [ ] Any statement about how seller tax is handled

**Currently true and safe to say:** BidBlitz operates an auction marketplace
that records sales and, with a payment provider connected, collects buyer
payments through that provider.

---

## E. Sign-off

Before launch, an owner with authority over A1–A10 signs off that the facts
above are complete and correct.

| Field | Value |
| --- | --- |
| Name | |
| Role | |
| Date | |
| Items still outstanding | |

**Until this section is filled in, BidBlitz is not commercially live.** The
technical work can be complete and the site can be fully operational; that
does not make it a lawful, registered marketplace, and no amount of code
changes that.
