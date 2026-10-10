"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCampaignAction } from "@/server/actions/marketing-campaigns";
import type { CreateCampaignInput } from "@/lib/marketing/campaigns";

const initial: CreateCampaignInput = {
  title: "", objective: "SELLER_ACQUISITION", destination: "sell",
  source: "instagram", medium: "social", campaignTag: "",
  contentTag: "", brief: "", budgetUsd: "0.00", plannedDate: "",
};
const inputClass = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm font-medium shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const labelClass = "space-y-1.5 text-sm font-bold";

export function CreateCampaignForm() {
  const router = useRouter();
  const [draft, setDraft] = useState<CreateCampaignInput>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  function set<K extends keyof CreateCampaignInput>(key: K, value: CreateCampaignInput[K]) {
    setDraft((before) => ({ ...before, [key]: value }));
    setSaved(false);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const outcome = await createCampaignAction(draft);
        if (outcome.ok) {
          setMessage("Campaign draft saved. It has not been posted and no money has been spent.");
          setSaved(true);
          setDraft(initial);
          router.refresh();
        } else {
          setMessage(outcome.message);
        }
      } catch {
        setSaved(false);
        setMessage("Could not save this campaign. Check your connection and retry.");
      }
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-labelledby="campaign-create-heading">
      <div className="border-b bg-muted/20 px-5 py-5 sm:px-7">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-primary">
          <CalendarClock className="size-4" aria-hidden /> Plan / Approve / Launch
        </p>
        <h2 id="campaign-create-heading" className="mt-2 text-xl font-black tracking-tight">Create a campaign brief</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          A real campaign plan with an audit trail. No automatic social posting, email, or payment.
        </p>
      </div>
      <form method="post" onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
        <label className={labelClass+" sm:col-span-2"}>
          <span>Campaign name</span>
          <input className={inputClass} required minLength={3} maxLength={100}
            placeholder="Harare gaming Friday" value={draft.title} onChange={e=>set("title",e.target.value)} disabled={pending} />
        </label>
        <label className={labelClass}>
          <span>Goal</span>
          <select className={inputClass} value={draft.objective} disabled={pending}
            onChange={e=>set("objective",e.target.value as CreateCampaignInput["objective"])}>
            <option value="SELLER_ACQUISITION">Recruit verified sellers</option>
            <option value="BUYER_ACQUISITION">Reach new buyers</option>
            <option value="AUCTION_EVENT">Promote auction event</option>
            <option value="REACTIVATION">Bring previous users back</option>
          </select>
        </label>
        <label className={labelClass}>
          <span>Destination</span>
          <select className={inputClass} value={draft.destination} disabled={pending}
            onChange={e=>set("destination",e.target.value as CreateCampaignInput["destination"])}>
            <option value="sell">Sell an item</option><option value="auctions">Browse auctions</option><option value="home">Homepage</option>
          </select>
        </label>
        <label className={labelClass}>
          <span>Campaign code (unique)</span>
          <input className={inputClass} required minLength={3} maxLength={70} disabled={pending}
            placeholder="friday_blitz_oct" value={draft.campaignTag} onChange={e=>set("campaignTag",e.target.value)} />
          <span className="block text-[11px] font-normal text-muted-foreground">Letters, numbers, spaces, dashes and underscores are normalized.</span>
        </label>
        <label className={labelClass}>
          <span>Planned budget (USD)</span>
          <input className={inputClass} required inputMode="decimal" maxLength={20} disabled={pending}
            placeholder="0.00" value={draft.budgetUsd} onChange={e=>set("budgetUsd",e.target.value)} />
          <span className="block text-[11px] font-normal text-muted-foreground">Planning only, not a charge or payout.</span>
        </label>
        <label className={labelClass}>
          <span>Traffic source</span>
          <input className={inputClass} required minLength={2} maxLength={70}
            value={draft.source} disabled={pending} onChange={e=>set("source",e.target.value)} />
        </label>
        <label className={labelClass}>
          <span>Marketing medium</span>
          <input className={inputClass} required minLength={2} maxLength={70}
            value={draft.medium} disabled={pending} onChange={e=>set("medium",e.target.value)} />
        </label>
        <label className={labelClass}>
          <span>Content identifier <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input className={inputClass} maxLength={70} placeholder="creator_a_reel_01"
            value={draft.contentTag} disabled={pending} onChange={e=>set("contentTag",e.target.value)} />
        </label>
        <label className={labelClass}>
          <span>Planning date <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input className={inputClass} type="date" value={draft.plannedDate} disabled={pending}
            onChange={e=>set("plannedDate",e.target.value)} />
          <span className="block text-[11px] font-normal text-muted-foreground">A planning reminder only; nothing launches automatically.</span>
        </label>
        <label className={labelClass+" sm:col-span-2"}>
          <span>Creative brief</span>
          <textarea className="min-h-28 w-full rounded-lg border bg-background p-3 text-sm" maxLength={2000} disabled={pending}
            placeholder="Who are we reaching? What are we showing? What claim can we prove?"
            value={draft.brief} onChange={e=>set("brief",e.target.value)} />
        </label>
        <div className="space-y-3 sm:col-span-2">
          <Button type="submit" disabled={pending} className="min-h-11">
            {pending ? <Save className="mr-2 size-4" aria-hidden /> : <Plus className="mr-2 size-4" aria-hidden />}
            {pending ? "Saving campaign…" : "Save campaign draft"}
          </Button>
          {message && <p role={saved ? "status" : "alert"} className={saved
            ? "rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
            : "rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs font-semibold text-destructive"}>{message}</p>}
        </div>
      </form>
    </section>
  );
}
