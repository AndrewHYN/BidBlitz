import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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
  SOLD: "Auction sold", UNSOLD: "Unsold", CANCELLED: "Cancelled",
};
const stateLabel = (state: string) => stateNames[state] ?? state.replaceAll("_", " ").toLowerCase();
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-ZW", {
  day: "numeric", month: "short", timeZone: "Africa/Harare",
}).format(new Date(date));

function CountChart({ title, items }: { title: string; items: [string, number][] }) {
  const max = Math.max(1, ...items.map(([, value]) => value));
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
      <h3 className="font-semibold">{title}</h3>
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


type ChartProps = { title: string; items: [string, number][] };
const statusColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function DailyChart({ title, items }: ChartProps) {
  if (!items.length) return <CountChart title={title} items={items} />;

  const step = Math.max(1, Math.ceil(Math.max(...items.map(([, value]) => value)) / 4));
  const max = step * 4;
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
      <h3 className="font-semibold">{title}</h3>
      <div aria-hidden="true">
        <div className="flex gap-2">
          <div className="-my-2 flex flex-col justify-between text-xs tabular-nums text-muted-foreground">
            {[max, step * 3, step * 2, step, 0].map((tick) => <span key={tick}>{tick.toLocaleString("en-ZW")}</span>)}
          </div>
          <div className="relative flex h-32 flex-1 items-end gap-1 sm:gap-1.5">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2, 3, 4].map((line) => <div key={line} className="border-t border-border" />)}
            </div>
            {items.map(([day, value]) => (
              <div key={day} className="relative flex-1 rounded-t-sm bg-primary" style={{ height: `${value / max * 100}%` }}
                title={`${day}: ${value.toLocaleString("en-ZW")}`} />
            ))}
          </div>
        </div>
        <div className="mt-2 flex justify-between pl-5 text-xs text-muted-foreground">
          <span>{items[0][0]}</span>
          <span>{items.at(-1)?.[0]}</span>
        </div>
      </div>
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Daily totals</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {items.map(([day, value]) => (
            <div key={day} className="flex justify-between gap-1">
              <dt>{day}</dt><dd className="tabular-nums">{value.toLocaleString("en-ZW")}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

function StatusChart({ title, items }: ChartProps) {
  const total = items.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return <CountChart title={title} items={items} />;

  const segments = items.map(([label, value], index) => {
    const previousTotal = items.slice(0, index).reduce((sum, [, count]) => sum + count, 0);
    return {
      label,
      value,
      start: previousTotal / total * 100,
      end: (previousTotal + value) / total * 100,
      color: statusColors[index % statusColors.length],
    };
  });
  const gradient = segments.map(({ color, start, end }) => `${color} ${start}% ${end}%`).join(", ");
  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4">
      <h3 className="font-semibold">{title}</h3>
      <div className="flex flex-wrap items-center gap-4">
        <div aria-hidden="true" className="grid size-24 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
          <span className="grid size-[4.5rem] place-items-center rounded-full bg-card font-semibold tabular-nums">{total.toLocaleString("en-ZW")}</span>
        </div>
        <ul className="min-w-36 flex-1 space-y-1.5 text-sm">
          {segments.map(({ label, value, color }) => (
            <li key={label} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="flex-1">{label}</span>
              <span className="tabular-nums">{value.toLocaleString("en-ZW")}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export async function MarketplaceActivity() {
  const db = await createClient();
  const response = await db.rpc("marketplace_activity_summary", {});
  const parsed = summary.safeParse(response.data);
  const activity = !response.error && parsed.success ? parsed.data : null;

  return (
    <section id="marketplace-activity" aria-labelledby="marketplace-activity-heading" className="space-y-4 scroll-mt-24">
      <h2 id="marketplace-activity-heading" className="text-xl font-semibold tracking-tight">Marketplace activity</h2>
      {!activity ? <p role="alert">Marketplace activity could not be loaded.</p> : <>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
          {([
            ["Accounts", activity.accounts],
            ["Confirmed accounts", activity.confirmed],
            ["Public page views · 14 days", activity.days.reduce((sum, day) => sum + day.views, 0)],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-3 last:col-span-2 sm:p-4 sm:last:col-span-1">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("en-ZW")}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted-foreground">Page views count visits to Home, Browse and listing pages from when tracking started. Repeat visits count again.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <DailyChart title="Daily sign-ups · 14 days" items={activity.days.map(day => [dateLabel(day.day), day.signups])} />
          <DailyChart title="Daily page views · 14 days" items={activity.days.map(day => [dateLabel(day.day), day.views])} />
          <StatusChart title="Listing status" items={Object.entries(activity.states).map(([state, count]) => [stateLabel(state), count])} />
          <CountChart title="Published or marked sold by category" items={Object.entries(activity.categories)} />
        </div>
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">Recent listings</h3>
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
        {activity.contacts && <details className="space-y-3 rounded-xl border bg-card p-4">
          <summary className="cursor-pointer font-semibold">Recent accounts · service contacts</summary>
          <ul className="divide-y divide-border">
            {activity.contacts.map(account => (
              <li key={account.email} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <a className="break-all text-primary underline" href={`mailto:${account.email}`}>{account.email}</a>
                <span className="text-muted-foreground">{account.confirmed ? "Confirmed" : "Awaiting confirmation"} · {dateLabel(account.created_at)}</span>
              </li>
            ))}
          </ul>
        </details>}
      </>}
    </section>
  );
}
