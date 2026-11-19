import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/permissions";
import { createClient } from "@/lib/supabase/server";
import { CommunityDecision } from "@/components/dashboard/community-decision";

export const metadata: Metadata = { title: "Community reports", robots: { index: false, follow: false } };

export default async function CommunityQueue() {
  if (!(await requirePermission("reports.view")).ok) notFound();
  const db = await createClient();
  const { data, error } = await db.rpc("marketplace_moderation_queue", {});
  return <main className="page-container max-w-3xl space-y-5 py-8">
    <Link href="/admin" className="text-sm font-semibold text-primary underline">Admin overview</Link>
    <h1 className="text-3xl font-bold">Community reports</h1>
    {error ? <p role="alert">Reports could not be loaded. Refresh to try again.</p> : data?.length ? <ul className="space-y-4">
      {data.map(row => <li key={row.report_id} className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Reported {row.kind}{row.username && <> by <Link className="text-primary underline" href={`/profile/${row.username}`}>@{row.username}</Link></>}</h2>
        <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3">{row.excerpt}</blockquote>
        <p className="break-words text-sm"><strong>Reason given</strong> · {row.reason}</p>
        <p className="text-xs text-muted-foreground">Filed {new Date(row.created_at).toLocaleDateString("en-ZW")}</p>
        <CommunityDecision id={row.report_id} kind={row.kind} />
      </li>)}
    </ul> : <p>No open community reports.</p>}
  </main>;
}
