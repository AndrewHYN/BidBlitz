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
