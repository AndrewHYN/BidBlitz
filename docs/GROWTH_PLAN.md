# Growth plan — first real marketplace test

Status: active operator document. It is a business plan, not site content.
Nothing on this page may be rendered in the product UI, and nothing in it may be
back-filled with numbers that were not actually counted.

Related: `docs/INTERNAL_LAUNCH_CHECKLIST.md` (business facts the owner must
supply), `docs/COMPLIANCE_LAUNCH_CHECKLIST.md` (gates K0–K20), `docs/MVP_SPEC.md`.

---

## 1. The goal, stated plainly

BidBlitz has a working transaction loop and an almost empty marketplace. Those
are two very different problems, and only the second one is still open.

The product loop that already works and must not be touched:

```
seller creates -> publishes -> buyers discover -> competing bids -> realtime
updates -> authoritative close -> winner -> transaction -> fee
```

The loop that does **not** work yet is distribution: real sellers do not yet
know the site exists, and a marketplace with no inventory cannot be discovered
by buyers either. That is the whole remaining launch problem.

**Do not try to fix a liquidity problem with a technology problem.** No new
features, no AI, no subscriptions, no redesign. The constraint is the number of
real people who have listed something.

---

## 2. The ladder

Hit each rung before spending effort on the next. The numbers are targets for
*real, distinct, live listings* — never placeholders, never seeded inventory,
never an auction created by the founder to make Browse look populated.

| Rung | Sellers | Live listings | What unlocks |
| --- | --- | --- | --- |
| 0 | 0 | 0 | Nothing else matters yet. |
| 1 | **10** | **20** | The homepage stops looking empty; Browse has a second page; a buyer can find *something*. |
| 2 | **25** | **50** | Category pages start filling; a buyer can find something in more than one category; word of mouth has somewhere to land. |
| 3 | scale | scale | Only now spend on traffic: sharing, groups, listing syndication, paid promotion. |

Rules for the ladder:

- **20 live listings is 20 listings a stranger could actually win.** Counting a
  draft, a cancelled auction or the founder's own test record is how a marketplace
  fool itself. Only `status = LIVE` counts toward a rung.
- **One seller counts once**, however many listings they have. Ten listings from
  one person is a rung of one.
- A listing that ends unsold still counts as a listing that existed; it stops
  counting toward *live* inventory once it closes.
- Record the date each rung was reached. If a rung is reached by seeding, note
  it as seeded — never report a seeded rung as market traction.

---

## 3. Where the first 10 sellers come from

Warm, direct, one at a time. This is not a marketing channel exercise; at this
size it is a sales conversation.

**Highest yield first:**

1. **People you already know who already sell things.** Anyone running a small
   shop, a repair business, a second-hand phone trade, or posting items in
   WhatsApp and Facebook buy-and-sell groups. They already have inventory and
   already have the problem BidBlitz solves: finding out what something is
   actually worth instead of guessing.
2. **One category at a time.** A seller who lists three phones is more useful
   than three sellers who each list one unrelated item, because buyers search by
   category and a page with only one item in it does not hold a visitor.
3. **Sit with the first three sellers.** Watch them fill in the form. If they
   stall on title, description, photos or the closing time, that is a product
   finding — fix the copy, do not write the listing for them.

**Approach that works at this size:**

> "I built an auction site. It closes on a real clock, the server decides the
> winner, and the only fee is 5% when it sells. Can I list one of your items so
> you can see what it goes for?"

That pitch is honest, specific, and costs the seller nothing when the auction
does not sell.

**Do not:**

- buy listings, pay people to list, or list on their behalf without saying so;
- create auctions yourself to make Browse look busy — see §6;
- promise a price, a buyer, or a timeframe you cannot deliver;
- claim a partner, endorsement or press coverage that has not happened.

---

## 4. Category focus

Start narrow. The first four rungs should be won in roughly this order, because
each is easy to describe in one line, easy to photograph, and easy to judge the
condition of without seeing it in person:

| Priority | Category | Why first |
| --- | --- | --- |
| 1 | **Phones** | Highest search intent, condition is easy to describe, everyone knows what they are worth. |
| 2 | **Laptops** | Same logic, larger ticket size, so one sale proves the payout path end to end. |
| 3 | **Electronics** (consoles, audio, cameras) | Overlaps with the buyers phones already bring in. |
| 4 | **Gaming** (consoles, games, accessories) | Strong community sharing behaviour; natural for groups. |
| 5 | **Useful household items** | Widens the base once the first four have depth, not before. |

Two listings in two categories beat ten in one — but zero in a category is
better than one, because a category with a single listing looks abandoned. Only
open a category once you have at least three sellers ready to list into it.

Do not build SEO landing pages for categories that have no listings. A thin
category page ranks for nothing and reads as an empty shop.

---

## 5. Founder / operator daily checklist

Run this every day until Rung 2. It takes about 45 minutes.

**Inventory**
- [ ] How many auctions are `LIVE` right now? (Write the real number.)
- [ ] How many close in the next 48 hours, and how many of those have zero bids?
- [ ] Any auction ending tonight with a bidder who never got a nudge?
- [ ] Drafts sitting unpublished — chase those sellers; they are one tap from live.

**Acquisition**
- [ ] Did I approach at least one potential new seller today?
- [ ] Did I follow up with everyone who said "later"?
- [ ] Did I list at least one new item myself — or is that someone else's job?

**Operations**
- [ ] Any transaction sitting in `AWAITING_PAYMENT` longer than the provider's
      window? Close it out rather than leaving a seller waiting.
- [ ] Any payout waiting on me? Payout is a controlled manual step — it does not
      move on its own, so nothing moves if this is skipped.
- [ ] Any dispute, report or moderation flag unread? These are read by a person.
- [ ] Any seller asking a question I answered by email that should be on `/faq`?

**Signal**
- [ ] Which single listing got the most bids? Why — title, price, photos, category?
- [ ] Did anyone arrive from a link I can see in referrer data?
- [ ] Write one sentence: what I learned today about how people actually buy here.

**Never on this checklist:** inventing a counter, seeding a bid, or writing a
review. A single fake bid destroys the only thing that makes an auction worth
watching — that the price is real.

---

## 6. What this plan explicitly forbids

- Fake inventory, fake listings, or founder accounts posing as buyers or sellers.
- Fake bidder counts, view counts, user counts, GMV or revenue — on the site, in
  a deck, or in a screenshot.
- Fake reviews, ratings, testimonials or activity of any kind.
- Bidding on your own auction to make a listing look contested (blocked in the
  database anyway).
- Claiming a partnership, press mention, approval, licence or legal status that
  has not been evidenced.

Marketplace emptiness is not a shame to hide. "No auctions are listed yet" with
two working next steps is a better page than a marketplace pretending to be
busy, and buyers can tell the difference instantly.

---

## 7. Google discovery — what is true

**A domain not showing up in Google is not a penalty.** BidBlitz is a new
domain, and new domains are crawled, evaluated and indexed on their own
timetable — typically days to weeks for a first page, considerably longer before
it competes for anything. There is no evidence of a manual action, and none
should be claimed either way without Search Console data.

What the code already provides, and what remains an owner action:

| Item | State |
| --- | --- |
| Canonical origin `https://bidblitz.co.zw` on every generated URL | In code (`src/lib/site-url.ts`) |
| `robots.txt` with allow/disallow rules and a sitemap pointer | In code (`src/app/robots.ts`) |
| `sitemap.xml` — static routes, live/scheduled auctions, plus completed auctions that actually drew bids | In code (`src/app/sitemap.ts`) |
| Page titles, descriptions, canonical tags, OpenGraph and Twitter cards | In code |
| Structured data: `Organization` + `WebSite` site-wide; `Product` + `BreadcrumbList` on auctions | In code |
| 404s that return a real status and `noindex` rather than a copy of the homepage | In code |
| Internal links between home → browse → auction → category, plus about / how-it-works / faq / help | In code |
| **Submit the sitemap in Google Search Console** | **Owner action** |
| **Verify which host is canonical and 301 the other** | **Owner action** (see below) |
| **Indexing is reported as "Discovered — currently not indexed"** | **Normal.** Re-check after fresh, useful content lands. |

### The www / apex decision (owner action, before promoting search traffic)

Production direction is stated as `https://www.bidblitz.co.zw`, while every
canonical URL the application generates uses `NEXT_PUBLIC_SITE_URL`, documented
and defaulted to the apex `https://bidblitz.co.zw`. Which host actually serves
production was **not verified in this pass** — that is precisely the thing the
owner must confirm in the dashboard. If they disagree, the canonical tag on
every page points at a host that redirects back: Google resolves that conflict
however it likes, which is exactly the outcome to avoid.

Exactly one of these must be true after cutover, and both halves must agree:

1. **Apex canonical:** `NEXT_PUBLIC_SITE_URL=https://bidblitz.co.zw`, and
   `https://www.bidblitz.co.zw` 301-redirects to it.
2. **www canonical:** `NEXT_PUBLIC_SITE_URL=https://www.bidblitz.co.zw`, and
   `https://bidblitz.co.zw` 301-redirects to it — then this file, `.env.example`
   and `docs/DEPLOYMENT.md` are updated to match so the docs stop disagreeing
   with production.

Do not run both as hosts. Verify with Search Console's URL inspection after the
change, not with a browser tab that has a cache.

---

## 8. What to measure (real numbers only)

Weekly, from the database — never from memory:

- live listings and distinct sellers (current rung position);
- auctions created / published / closed, and the closed split sold vs unsold;
- bids per auction (median and best) — the real test of whether the reserve and
  starting bid are set sensibly;
- share of auctions that received **at least one** bid — a low number here is a
  listing-quality problem, not a traffic problem;
- transactions reaching `PAID`, then reaching a released payout;
- disputes opened and how they resolved;
- where buyers actually came from.

If a number is not counted, it is not reported. That rule is the reason anyone
should believe the numbers that are.
