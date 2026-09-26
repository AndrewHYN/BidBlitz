"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { absoluteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";

/**
 * Share a published auction.
 *
 * The URL is ALWAYS built from the canonical site origin (site-url.ts) —
 * never `window.location` — so a shared link points at production even when
 * the page is being viewed from a preview or local origin.
 *
 * Two affordances, both real:
 *   - "Share": the native share sheet where the platform offers one,
 *     falling back to copy where it doesn't (or fails for any reason
 *     other than the user dismissing the sheet);
 *   - copy-link icon: always copies, deterministic, keyboard-accessible.
 */
export function ShareButton({
  auctionId,
  title,
  size = "lg",
  className,
}: {
  auctionId: string;
  title: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = absoluteUrl(`/auction/${auctionId}`);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied", {
        description: "Paste it anywhere to share this auction.",
      });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn’t copy the link — you can copy it from the address bar.");
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // The user dismissed the native sheet: that IS their decision — no
        // toast, no surprise copy. Anything else falls through to copying.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copyLink();
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={share}
        data-testid="share-auction"
      >
        <Share2 aria-hidden />
        Share
      </Button>
      <Button
        type="button"
        variant="ghost"
        size={size}
        onClick={copyLink}
        data-testid="copy-auction-link"
        aria-label="Copy auction link"
        title="Copy auction link"
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}
