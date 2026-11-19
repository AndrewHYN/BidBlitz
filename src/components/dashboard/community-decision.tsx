"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { decideContentReport } from "@/server/actions/community";

export function CommunityDecision({ id, kind }: { id: string; kind: string }) {
  const [message, action, pending] = useActionState(decideContentReport, "");
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="report" value={id} />
    {kind === "review" && <Button type="submit" name="decision" value="hide" variant="destructive" disabled={pending}>Hide review and resolve</Button>}
    <Button type="submit" name="decision" value="resolve" variant="outline" disabled={pending}>Resolve report</Button>
    <Button type="submit" name="decision" value="dismiss" variant="ghost" disabled={pending}>Dismiss report</Button>
    {message && <p role="status" className="basis-full text-sm">{message}</p>}
  </form>;
}
