"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyCampaignLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="mr-2 size-4" aria-hidden /> : <Copy className="mr-2 size-4" aria-hidden />}
          {copied ? "Copied" : "Copy tracking link"}
        </Button>
        {error && <p role="alert" className="text-xs text-destructive">Clipboard blocked. Select and copy the URL shown below.</p>}
      </div>
      <input value={link} readOnly onFocus={(e)=>e.currentTarget.select()}
        aria-label="Campaign tracking URL" className="h-9 w-full rounded-lg border bg-muted/20 px-3 font-mono text-xs" />
    </div>
  );
}
