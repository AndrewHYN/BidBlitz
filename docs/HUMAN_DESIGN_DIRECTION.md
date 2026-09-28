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
