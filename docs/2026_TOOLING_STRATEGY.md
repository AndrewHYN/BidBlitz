# BidBlitz 2026 Tooling Strategy

This project is intentionally not locked to the initial stack.

## Preferred decision

Use one primary web framework. Start with Next.js App Router unless a time-boxed evaluation proves TanStack Start materially improves delivery, reliability, or deployment for this project. Do not install both frameworks.

## Tool selection

- UI: Tailwind CSS v4 + shadcn/ui. For new shadcn projects, Base UI is the current default; Radix remains supported. Do not replace a stable installed component base merely to chase a new default.
- Animation: Motion for React (formerly Framer Motion). Use it for purposeful micro-interactions, auction state transitions, sheets, drawers, and celebration states. Keep motion lightweight and accessible.
- Client server-state: TanStack Query where client-side caching, synchronization, invalidation, or optimistic/non-financial updates materially improve UX. Do not duplicate Next.js server fetching without a reason.
- Validation: Zod in TypeScript. Pydantic only if a Python service is actually introduced.
- Database: PostgreSQL.
- Realtime: Supabase Realtime Broadcast or an equivalent transport behind a BidBlitz realtime adapter.
- Edge utilities: Cloudflare Workers may be used for small stateless edge tasks such as image/metadata processing, webhooks, verification, or other workloads where it clearly helps. Do not add Workers just to increase the technology count.
- Durable workflows: Temporal is an option for future long-running, retryable workflows (payments, settlement, notifications, reconciliation). It is not required for the 3-day MVP if it creates deployment or operational overhead.
- Browser QA: Playwright is mandatory for critical E2E and responsive verification.
- Observability: add Sentry or an equivalent only when it can be configured safely and quickly.
- Product analytics: PostHog or an equivalent is appropriate if it can be added without blocking the core build.
- Product/design planning: tldraw/Excalidraw may be used for architecture/flow diagrams when useful; Linear can be used for execution tracking if the team has access. Do not make either a runtime dependency.
- AI coding workflow: OpenCode is the implementation agent. It should use the repository documents, browser verification, tests, and current official docs rather than blindly following old snippets.

## Principle

Use a tool because it solves a concrete product or engineering problem. Do not install tools simply because an article lists them.

The article that inspired this strategy lists ShadCN + Tailwind CSS, TanStack Query/Router, Framer Motion, Playwright, Temporal, Cloudflare Workers, FastAPI, Zod/Pydantic, Postgres, tldraw/Excalidraw, Linear, and AI coding tools as a 2026 toolkit. BidBlitz should selectively adopt the parts that improve this product within its 3-day delivery constraint.
