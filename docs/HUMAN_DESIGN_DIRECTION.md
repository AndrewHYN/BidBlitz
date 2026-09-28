# BidBlitz — Human-quality visual direction

## Why this pass exists

The product is functionally mature. The visual system now needs a deliberate point of view so the interface reads as a product designed for live auctions, not as a generic AI-assisted SaaS template.

Contemporary commentary on AI-generated interfaces repeatedly points to the same failure mode: not one bad component, but repetition of familiar defaults — centered hero + generic CTA, repeated rounded cards, pill-heavy controls, soft shadows/gradients, and interchangeable copy. The useful distinction is **specificity and product intent**, not whether AI was used.

## BidBlitz point of view

BidBlitz should feel like:

- a clean auction room
- a live sporting event when bidding is active
- practical commerce when users are buying/selling
- confident, compact and slightly energetic
- trustworthy around money and fulfilment

It should not feel like a crypto dashboard, AI startup landing page, gaming neon site, or generic marketplace clone.

## Visual system

### Colour

Move the primary brand away from saturated purple toward a warm BidBlitz signal colour: burnt orange / amber with a restrained red-orange urgency accent.

Keep the base surfaces quiet: warm white/light neutral and deep charcoal dark mode.

Use colour by meaning:
- brand action: warm orange
- live: green
- ending/urgency: amber/orange
- destructive: red
- neutral UI: ink, warm gray, border

Do not use purple gradients.

### Surfaces

Use fewer containers.

Not every section needs a card. Reserve cards for actual objects:
- auction
- transaction
- message
- profile identity
- important operational panel

Prefer hierarchy through whitespace, typography, dividers and alignment before adding another box.

Normal controls can stay subtly rounded, but avoid making every element a pill.

### Layout

Use asymmetry deliberately.

Public pages should have editorial composition:
- strong left-aligned headline
- meaningful secondary content
- clear content rails
- occasional full-width divider
- fewer repeated three-column blocks

Auction detail should prioritize:
1. item
2. current price
3. time remaining
4. bid action
5. trust/condition/shipping information

Dashboards should prioritize tasks and activity over rows of decorative metric cards.

Profiles should read like a real person page, not a statistics panel.

### Typography

Keep the existing Geist foundation unless a real reason emerges to replace it.

Create hierarchy through:
- stronger headline size/weight
- short useful labels
- generous line-height for body copy
- tabular numerals for prices/countdowns
- fewer all-caps labels

Do not make everything bold.

### Imagery

Real seller photography should be the star.

For auction cards:
- consistent image frame
- restrained hover zoom (around 1.02–1.03)
- no aggressive parallax
- never distort product proportions
- never make placeholder/fallback imagery look like a real product

## Motion language

Motion must communicate state or affordance.

Use:
- 160–220ms hover transitions for controls
- small 1–2px button lift on hover
- 2–4px auction-card lift on hover
- 1.02–1.03 image zoom on hover
- short enter transitions for drawers, dialogs and meaningful page elements
- restrained bid/update feedback
- smooth focus/pressed states

Do not:
- bounce buttons
- animate every section on scroll
- use cursor-follow effects
- make decorative objects constantly move
- use long cinematic entrance animations
- make motion compete with the auction clock

Respect reduced motion.

## Component rules

### Buttons
Primary buttons are visually decisive. Secondary actions are quieter. Avoid three or four equally prominent buttons in one area.

### Chips/badges
Pills are acceptable for statuses and compact filters. They are not the default shape for every action.

### Cards
Cards should have a reason to exist. Avoid identical card shells repeated for unrelated content.

### Navigation
The header should feel like a marketplace tool, not a marketing navbar. Search is important. Account identity and notifications should remain easy to find.

### Empty states
Explain why the space is empty and what a user can do next. Never simulate activity.

### Forms
Use clear labels, short helper text and immediate feedback. Password reset remains part of the product and gets polished in this pass.

## Page-specific direction

### Home
Lead with the actual proposition: live competitive auctions. Prefer an editorial hero over a large generic boxed hero. Search and "List an item" should be easy to understand immediately.

### Browse
Make it feel like a catalog, not a dashboard. Strong result hierarchy, useful filters, compact controls, large product imagery and clear current bid/time.

### Auction detail
Make price, clock and bid action visually dominant. Supporting information should be quieter and structurally grouped.

### Profile
Identity first: avatar, name, location, join date and genuine reputation. Listings and reviews follow. Do not invent social metrics.

### Selling
Make publishing an item feel like a guided commercial workflow. The seller should always know what is required, what is locked after publish, and what proceeds mean.

### Buying / transactions
Prioritize what needs attention now: won auction, payment, payment status, delivery/fulfilment and payout expectations. Avoid decorative KPI panels with no action.

### Authentication
Signup, login and password reset should feel like one coherent account system. Keep the forms calm, trustworthy and human.

### Admin
Functional density is appropriate here. It should look operational and deliberate rather than like a consumer dashboard.

## Human-quality test

For every major section ask:

1. Why does this section exist?
2. Why is it in this position?
3. Why is it this shape?
4. What real user action does it support?
5. Would removing it make the product clearer?

If there is no good answer, remove it.

## Research references

- InterfaceKit — What makes a website look AI-generated:
  https://blog.interfacekit.io/what-makes-a-website-look-ai-generated
- SmoothUI — AI Design Slop: Why AI-Generated UI Looks Generic:
  https://smoothui.dev/blog/ai-design-slop
- Tim Armstrong Marketing — avoiding the AI-generated website look:
  https://timarmstrongmarketing.com/blog/avoiding-ai-generated-website-design/

These are used as design heuristics, not as proof that any particular visual choice is inherently bad.

---

# What the 2026-09-28 pass decided

The direction above says *what* the product should feel like. This records the
calls that pass actually made, so a later change has to argue with a decision
rather than rediscover the problem.

## The measurement that drove it

The share of page elements that are a bordered, rounded box taller than 60px:

| Page | Before | After |
| --- | --- | --- |
| Terms | 19% | 1% |
| Privacy | 13% | 1% |
| Fees | 11% | 4% |
| Help | 5% | 5% (cards became an index) |
| Browse | 5% | 2% |
| Home | 2% | 0% |

Not a target, just a way of finding where the frames were. Every reduction
below was confirmed by looking at the rendered page afterwards.

## Decisions

**A long-form page is a document, not a set of cards.** Terms had twelve
bordered sections; Privacy had nine. A border around every three-paragraph block
breaks the paragraph rhythm reading depends on and adds a dozen competing
frames. All five long-form pages — Terms, Privacy, Help, Fees, Bidding rules —
now share `src/components/document-page.tsx`: one 68ch measure, sections divided
by a rule, a sticky index at `lg` because twelve anchor targets with no visible
index is a navigation problem, and a plain list below `lg` rather than a control
that only exists with JavaScript.

**An empty state is an answer, not a placeholder.** It was a `border-dashed` box
at `py-16` holding ~60px of content, on the homepage and Browse. Dashed is the
vocabulary of *incomplete*; an empty marketplace is neither — it is a true fact
with a reason and a next step. Now a hairline and space, left-aligned at
desktop to match the home page, with a bare muted glyph rather than a coloured
disc.

**A card is for an object.** Kept: auctions, transactions, the contact block (a
way to reach a person), the worked fee examples (receipts, read line by line),
and the picture on Settings. Removed: a card per legal section, a card per
paragraph, three identical cards presenting a contents list, and seven cards
presenting a list of rules.

**Reputation is a sentence, not a KPI strip.** A profile read `RATING /
SALES / PURCHASES` in 11px uppercase — the dashboard pattern the direction
rejects, on the page that should read like a person. It is now "4.5 from 12
reviews · 32 completed sales", with the rating carried by the star. Nothing
invented: every number is a real aggregate.

**The bid is the loudest thing on the auction page.** It was the smallest — a
pale chip beside a wide empty field, inside a card inside the panel card. A bid
is one number and one decision, so the amount and the action are both full width
and 48px tall, stacked, and the form is no longer a card. The clock is one
reading, "58m 13s", not a box per unit.

**State is communicated once, in the strongest place.** Category, condition,
location and the starting bid were each shown twice on the auction page, which
makes a reader check which copy is current.

## Motion added, and motion withheld

Added: a 0.5px arrow nudge and background shift on index rows, so a row reads as
pressable without a lift that would fight the page.

Withheld: no entrance animation on any of the changes above. They are structural —
a box became a rule, a chip became a full-width button. Animating a structural
change delays the moment the user can read the new layout, and none of these
pages have a state worth animating in. The existing bid/outbid crossfade, card
lift and button press already carry the state changes, and they are unchanged.

## Still open

- **Password reset does not exist.** The design direction calls for it and the
  brief requires it. It is a feature gap, not a design gap.
- **No real inventory.** The empty states were designed against, but an auction
  page with a real photograph has not been seen, because production correctly has
  no listings. One temporary QA listing was published to review the auction page
  and removed; with a real photo, the gallery still needs a look.

---

# What the later 2026-09-28 work decided

Continued after the structural pass above. Same rule: record the call so a later
change argues with it rather than rediscovers the problem.

## Password reset

Built, because the brief requires it and it did not exist. `/forgot-password`,
the emailed link, `/reset-password`, and an explained state for a link that was
never issued, has expired, or was already used.

**The decision that matters is what it does not say.** The first implementation
forwarded provider errors, on the reasonable-sounding grounds that a user must
never be told to check an inbox when no email was sent. Measured against the
live provider:

```
unknown address  -> HTTP 200, {}
real account     -> HTTP 429, over_email_send_rate_limit
```

The provider answers a known address differently, and the difference is an
error. Forwarding it turns the form into an account-enumeration oracle. Since
`rate_limit_email_sent` is 2/hour, that quota is exhausted in ordinary use, so
the oracle was open **in production**. Every provider response is now
normalised to the same outcome. The one failure still reported is BidBlitz's
own budget, which is scoped to the request IP and the submitted address and
therefore gives the same answer either way.

`MIN_PASSWORD_LENGTH` lives in `@/lib/validation`, not the action file: a
`"use server"` module may only export async functions, and exporting a number
from one passes TypeScript, ESLint and `next build` and then fails at request
time.

## Browse filters are disclosed on a phone

Search, sort and a Filters button stay visible; category, condition and price
collapse below `sm`. The button counts active filters, so a collapsed panel is
never a hidden state. `sm:` and above shows everything — a viewport with room
for the whole panel would treat that as a downgrade.

## The dashboard leads with what needs you

Four equal KPI counters became: the counters only when something is in them, and
being outbid lifted to the top in the ending colour. Settling is deliberately
*not* repeated up there, because the page already has a section with a real
`SettleButton` beside each auction. Each section does one job.

## A card's heading level is the caller's decision

`AuctionCard` hardcoded `h3`, correct on the home page (cards sit under an
`h2` `SectionHeading`) and wrong on Browse (the only heading above a card is the
page `h1`). The defect was invisible while Browse had no inventory. It became
visible the moment the owner's own listing appeared. Card and grid now take the
level from the caller; the nested case is the default.

## Admin queues are queues

Payout and report rows lost their drop shadow and tightened spacing, so a
backlog reads as a list rather than as floating islands. **Reviewed from source
and from the non-admin refusal path only** — `/admin` needs the owner's
credentials, which are never handled here.

## Two defects the suite was structurally blind to

Both are worth more than their fixes, because each shows a gap in how the
project verifies itself.

**A `<p>` inside a `<p>` on /terms and /privacy.** Invalid HTML, so the parser
closes the outer element, the client tree stops matching the server, and React
discards and re-renders the subtree on every load. 263 unit tests, 136 database
checks and 60 e2e tests were all green throughout. The e2e assertions check
what the page *shows*, and the page showed correctly — React had repaired it in
the browser. Only the error showed the defect, and in production it is a
minified `#418`.

`e2e/hydration.spec.ts` now asserts on uncaught errors rather than content, for
all thirteen public pages. It was verified to have teeth: the bug was
reintroduced locally and the guard failed, then the fix was restored and it
passed.

**Contact links 23px tall** and a **`h1` → `h3` skip on every page** — both
found by measuring all twelve public pages in a browser, not by reading markup.

## Measurement artifacts, recorded so they are not "fixed"

An accessibility sweep reported three things that are correct as they stand, and
chasing them would have made the interface worse:

- the skip link measures 1×1 — visually hidden until focused, which is the
  intent;
- inline text links measure 18–20px — WCAG 2.5.8 exempts a target rendered
  inline in a block of text;
- three native `<select>` elements are unlabelled — Radix renders them
  `aria-hidden`, `tabindex="-1"` and clipped to 0×0 for form participation. The
  controls a user operates are `role="combobox"` and each is labelled by its
  `<label for>`.
