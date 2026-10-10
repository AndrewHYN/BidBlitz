"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { campaignStatusTargets } from "@/lib/marketing/campaigns";
import { changeCampaignStatusAction } from "@/server/actions/marketing-campaigns";

const LABEL: Record<string,string> = {
  READY: "Ready for team review", RUNNING: "Mark running", PAUSED: "Pause campaign",
  COMPLETED: "Complete campaign",
};
export function CampaignLifecycle({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  function update(next: string) {
    startTransition(async () => {
      try {
        const response = await changeCampaignStatusAction({ campaignId, status: next });
        setMessage(response.ok
          ? "Status recorded in the audit trail. This does not publish or pay for ads."
          : response.message);
        setConfirm(null);
        if (response.ok) router.refresh();
      } catch {
        setMessage("Could not change status. Check the current campaign and try again.");
      }
    });
  }

  const options = campaignStatusTargets(status);
  if (options.length === 0) return <p className="text-xs text-muted-foreground">Completed. This plan is archived as an audit record.</p>;
  return (
    <div className="space-y-3">
      {confirm ? (
        <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold">Mark campaign {confirm.toLowerCase()}? This records a staff workflow status only. No ad will be automatically published.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={() => update(confirm)}>
              {pending ? "Saving…" : "Confirm"}
            </Button>
            <Button type="button" size="sm" disabled={pending} variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((next) => (
            <Button key={next} type="button" size="sm" variant={next === "COMPLETED" ? "outline" : "secondary"} disabled={pending}
              onClick={() => { setConfirm(next); setMessage(null); }}>
              {LABEL[next] ?? next}
            </Button>
          ))}
        </div>
      )}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
