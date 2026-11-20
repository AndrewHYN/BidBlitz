import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Marketplace activity", robots: { index: false, follow: false } };
const counts = z.record(z.string(), z.number());
const summary = z.object({
  accounts: z.number(),
  confirmed: z.number(),
  days: z.array(z.object({ day: z.string(), views: z.number(), signups: z.number() })),
  states: counts,
  categories: counts,
  recentListings: z.array(z.object({ title: z.string(), listing_kind: z.string(), status: z.string(), created_at: z.string() })),
  contacts: z.array(z.object({ email: z.string(), confirmed: z.boolean(), created_at: z.string() })).nullable(),
});

const stateNames: Record<string, string> = {
  LISTED: "Available", LIVE: "Live auction", SOLD_DIRECT: "Marked sold by seller",
  DRAFT: "Draft", PENDING_REVIEW: "Awaiting review",
};
const stateLabel = (state: string) => stateNames[state] ?? state.replaceAll("_", " ").toLowerCase();
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-ZW", {
  day: "numeric", month: "short", timeZone: "Africa/Harare",
}).format(new Date(date));

function CountChart({ title, items }: { title: string; items: [string, number][] }) {
  const max = Math.max(1, ...items.map(([, value]) => value));
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No records yet</p> :
        <ul className="space-y-2">
          {items.map(([label, value]) => (
            <li key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(2rem,1fr)_auto] items-center gap-2 text-sm">
              <span>{label}</span>
              <div aria-hidden className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${value / max * 100}%` }} />
              </div>
              <span className="tabular-nums">{value.toLocaleString("en-ZW")}</span>
            </li>
          ))}
        </ul>}
    </section>
  );
}

export default async function MarketplaceActivityPage() {
  if (!(await requirePermission("analytics.view")).ok) notFound();
  const db = await createClient();
  const response = await db.rpc("marketplace_activity_summary", {});
  const parsed = summary.safeParse(response.data);
  const activity = !response.error && parsed.success ? parsed.data : null;

  return (
    <div className="page-container space-y-6 py-8">
      <Link href="/admin" className="text-sm font-medium text-primary underline">Admin overview</Link>
      <h1 className="text-3xl font-bold tracking-tight">Marketplace activity</h1>
      {!activity ? <p role="alert">Marketplace activity could not be loaded.</p> : <>
        <dl className="grid gap-3 sm:grid-cols-3">
          {([
            ["Accounts", activity.accounts],
            ["Confirmed accounts", activity.confirmed],
            ["Public page views · 14 days", activity.days.reduce((sum, day) => sum + day.views, 0)],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("en-ZW")}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">Page views count visits to Home, Browse and listing pages from when tracking started. Repeat visits count again.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <CountChart title="Daily sign-ups · 14 days" items={activity.days.map(day => [dateLabel(day.day), day.signups])} />
          <CountChart title="Daily page views · 14 days" items={activity.days.map(day => [dateLabel(day.day), day.views])} />
          <CountChart title="Listing status" items={Object.entries(activity.states).map(([state, count]) => [stateLabel(state), count])} />
          <CountChart title="Published or marked sold by category" items={Object.entries(activity.categories)} />
        </div>
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Recent listings</h2>
          {activity.recentListings.length === 0 ? <p className="text-sm text-muted-foreground">No listings yet</p> :
            <ul className="divide-y divide-border">
              {activity.recentListings.map((item, index) => (
                <li key={index} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span className="break-words">{item.title}</span>
                  <span className="text-muted-foreground">{stateLabel(item.status)} · {dateLabel(item.created_at)}</span>
                </li>
              ))}
            </ul>}
        </section>
        {activity.contacts && <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Recent accounts · service contacts</h2>
          <ul className="divide-y divide-border">
            {activity.contacts.map(account => (
              <li key={account.email} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <a className="break-all text-primary underline" href={`mailto:${account.email}`}>{account.email}</a>
                <span className="text-muted-foreground">{account.confirmed ? "Confirmed" : "Awaiting confirmation"} · {dateLabel(account.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>}
      </>}
    </div>
  );
}
