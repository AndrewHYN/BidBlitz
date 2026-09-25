<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BidBlitz Senior Engineering & Product Rules

## Product
BidBlitz is a fast live-auction marketplace.
Promise: "List it. Start the blitz. Get your price."

Optimize for the real transaction loop:
seller creates -> publishes -> buyers discover -> competing bids -> realtime updates -> authoritative close -> winner -> transaction -> fee.

## Quality bar
Treat this as a real commercial product, not a demo.
Own engineering, product, UI/UX, QA, security, performance, accessibility and release quality.
Make decisions without repeatedly asking the user to choose libraries or visual details.

## Free-tier-first rule
The current launch must work without paid subscriptions.
Do not make the MVP depend on paid Supabase/Vercel features.
Do not introduce paid-only infrastructure unless there is a clear free-tier fallback.
Document every paid upgrade as deferred work in `docs/POST_LAUNCH_BACKLOG.md`.
Current known examples:
- Supabase leaked-password protection may require a paid plan.
- Vercel Hobby cron is limited to once per day.
- Distributed/serverless rate limiting may need external infrastructure.
- Full payment/escrow/payout processing requires a real provider and appropriate compliance.
Never fake a paid feature.

## Truthfulness
Absolutely no:
- fake counters
- fake user counts
- fake GMV/revenue
- fake reviews
- fake testimonials
- fake ratings
- fake activity
- fake payment success
- fake payout
- fake inventory
- "made with AI" badges or tags
- placeholder text in production UI

If demo/seed data exists, label it as demo data or keep it in a clearly isolated demo environment.
Do not write marketing claims the application cannot substantiate.

## UI/UX rules
- No purple gradients.
- No vague hero copy. Explain exactly what BidBlitz does.
- No pill-shaped buttons for normal actions. Use purposeful button shapes with clear hierarchy.
- No cursor-following/animated cursor effects.
- No excessive scroll animations.
- No giant empty hero sections.
- No excessive glassmorphism, noisy gradients, or decorative clutter.
- No emojis in product UI when a real icon exists; use Lucide or another appropriate icon set.
- Logo is clickable and returns home.
- Phone number and email are real clickable links when displayed.
- Every interactive control must visibly look interactive.
- Every destructive/important action needs appropriate feedback.
- Use success and error messages intentionally.
- Use loading, empty, error, offline/reconnecting and success states.
- Keep interaction fast and obvious.
- Mobile is a first-class layout, not a scaled desktop page.

## Required UX audit
Before release, actively check:
- horizontal overflow
- mobile overflow
- clipped text
- broken images
- broken buttons
- dead links
- incorrect routes
- unused navigation items
- incorrect page titles
- missing meta descriptions
- missing favicon
- footer links
- custom 404
- auth redirects
- clickable logo
- tel: phone link
- mailto: email link
- copyright year
- image compression/optimization
- responsive image dimensions
- form validation
- success messages
- error messages
- focus states
- keyboard navigation
- touch targets

## Accessibility
Use semantic HTML, visible focus, accessible labels, good contrast, keyboard navigation, reduced-motion support, and status messages that are not conveyed by color alone.

## Motion
Motion for React is allowed and encouraged for meaningful micro-interactions, auction-state transitions, bid feedback and restrained success/error feedback.
Prefer transform/opacity.
Respect reduced motion.
Do not animate every section on scroll.
Do not add cursor animation.

## Component/tool policy
Use current stable tools where they materially improve the product:
- Tailwind CSS v4
- shadcn/ui
- Motion for React
- TanStack Query when client-side server-state benefits from it
- Zod
- Playwright
- PostHog/Sentry when useful and free-tier compatible
- Bklit UI for useful analytics charts only
- KokonutUI for useful UI components only
- tldraw/Excalidraw for architecture/flow diagrams only
Do not add libraries merely because they are fashionable.
Do not install multiple meta-frameworks.
Manus or similar AI tooling may assist development but is never a runtime dependency.

## Security
- Database/server is authoritative for auction state, time, bids, winners and fees.
- Never use floating point for money.
- Use integer minor units + currency.
- Concurrency-safe bids are mandatory.
- Idempotent bid requests are mandatory.
- Seller cannot bid on own auction.
- Closed auctions reject bids.
- Anti-sniping is server-side.
- RLS on exposed Supabase tables.
- No privileged secret in client bundles.
- Audit SECURITY DEFINER functions carefully: only keep elevated execution when required; pin search_path; restrict EXECUTE; schema-qualify objects.
- Test authorization and business-rule boundaries.
- Do not expose unnecessary private user data.

## Performance
Prioritize fast first render, optimized images, minimal client JS, no layout shift, fast navigation, and reliable realtime updates on mid-range phones.

## Deployment
Target Vercel + Supabase.
Use Git integration first.
Do not require a Vercel CLI token when Git integration can perform deployment.
Never claim a production deploy is verified without opening/testing the deployed URL.

## Testing
Before release:
- lint
- typecheck
- unit/integration tests
- database engine verification
- full Playwright desktop/mobile run
- real browser visual QA
- production smoke test
Fix real failures. Do not hide them with unlimited retries.

## Git
Commit meaningful milestones.
Inspect `git status` and diffs.
Keep the worktree clean.
Do not rewrite history or reset user work without a clear reason.
