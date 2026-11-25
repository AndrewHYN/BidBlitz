import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/permissions";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { AdminNav } from "@/components/dashboard/admin-nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Infrastructure health", robots: { index: false, follow: false } };
type Bucket = { bucket: string; files: number; bytes: number; average_bytes: number; largest_bytes: number; large_listing_files: number };
type Snapshot = { measuredAt: string; databaseBytes: number; storageBytes: number; buckets: Bucket[]; email: { sentToday: number; sentMonth: number; queued: number; failed: number; sending: number } };
function mb(bytes: number) { return (bytes / 1_000_000).toFixed(2) + " MB"; }
function Quota({ title, value, limit }: { title: string; value: number; limit: number }) {
  const pct = value / limit * 100;
  const status = pct >= 90 ? "Urgent" : pct >= 75 ? "Investigate" : pct >= 50 ? "Early warning" : "Below threshold";
  return <div className="rounded-xl border bg-card p-4 space-y-2">
    <h2 className="text-sm font-medium">{title}</h2>
    <p className="text-2xl font-semibold">{mb(value)}</p>
    <p className="text-xs text-muted-foreground">{pct.toFixed(1)}% of {mb(limit)} reference allowance · {status}</p>
    <progress className="w-full" max={100} value={Math.min(pct,100)} aria-label={title + " utilization"} />
  </div>;
}
export default async function InfrastructurePage() {
  if (!(await requirePermission("admin.access")).ok || !(await requirePermission("analytics.view")).ok) notFound();
  let snapshot: Snapshot | null = null;
  if (hasAdminCredentials()) {
    const { data, error } = await createAdminClient().rpc("infrastructure_health_snapshot");
    if (!error && data && typeof data === "object" && Array.isArray(data.buckets)) snapshot = data as Snapshot;
  }
  return <main className="page-container space-y-5 py-8">
    <AdminNav active="infrastructure" />
    <header><h1 className="text-2xl font-semibold">Infrastructure health</h1>
      <p className="text-sm text-muted-foreground">Read-only measurements on page load; no automatic polling or customer details.</p>
    </header>
    {!snapshot ? <p role="status" className="rounded-xl border p-4">Metrics unavailable. Check server configuration; no values have been assumed.</p> : <>
      <p className="text-xs text-muted-foreground">Measured: {new Date(snapshot.measuredAt).toLocaleString("en-GB", { timeZone: "Africa/Harare" })} CAT. Free-plan reference limits, not official billing counters.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Quota title="Database size" value={snapshot.databaseBytes} limit={500_000_000}/>
        <Quota title="Stored object bytes" value={snapshot.storageBytes} limit={1_000_000_000}/>
      </div>
      <section className="rounded-xl border bg-card p-4 space-y-3"><h2 className="font-semibold">Media storage</h2>
        {snapshot.buckets.map(b => <div key={b.bucket} className="border-t pt-3 text-sm">
          <p className="font-medium">{b.bucket} · {b.files} objects</p>
          <p className="text-muted-foreground">{mb(b.bytes)} total · {mb(b.average_bytes)} average · {mb(b.largest_bytes)} largest</p>
          {b.bucket === "auction-images" && <p>{b.large_listing_files} listing files above 350 KB</p>}
        </div>)}
      </section>
      <section className="rounded-xl border bg-card p-4 space-y-2"><h2 className="font-semibold">Application email outbox</h2>
        <p className="text-sm">Sent today (UTC): {snapshot.email.sentToday} · This month: {snapshot.email.sentMonth}</p>
        <p className="text-sm">Queued: {snapshot.email.queued} · Sending: {snapshot.email.sending} · Historical failures: {snapshot.email.failed}</p>
        <p className="text-xs text-muted-foreground">Excludes authentication email and other provider traffic. Not the Resend billing total.</p>
      </section>
    </>}
    <section className="rounded-xl border bg-card p-4 space-y-2"><h2 className="font-semibold">Provider limits</h2>
      <p className="text-sm text-muted-foreground">Cached egress, realtime, email quotas and hosting usage must be checked in the official dashboards. No billing usage estimate is displayed without a verified source.</p>
      <div className="flex flex-wrap gap-3 text-sm underline">
        <a href="https://supabase.com/dashboard/org/whypiurbdfolisgbebzf/usage" target="_blank" rel="noreferrer">Supabase usage</a>
        <a href="https://vercel.com/andrewhyn/~/usage" target="_blank" rel="noreferrer">Vercel usage</a>
        <a href="https://resend.com/overview" target="_blank" rel="noreferrer">Resend</a>
      </div>
    </section>
  </main>;
}
