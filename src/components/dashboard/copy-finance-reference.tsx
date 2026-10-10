"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyFinanceReference({ value, label = "Copy reference" }: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true); setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  return <span className="inline-flex flex-col items-start gap-1">
    <Button type="button" size="sm" variant="outline" onClick={copy}>
      {copied ? <Check className="mr-1 size-3" aria-hidden/> : <Copy className="mr-1 size-3" aria-hidden/>}
      {copied ? "Copied" : label}
    </Button>
    {failed && <span role="alert" className="text-[11px] text-destructive">Clipboard not available.</span>}
  </span>;
}
