"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { canonicalUrl as absoluteUrl } from "@/lib/site-url";
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
  compact = false,
}: {
  auctionId: string;
  title: string;
  size?: "default" | "sm" | "lg";
  className?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const url = absoluteUrl(`/listing/${auctionId}`);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied", {
        description: "Paste it anywhere to share this listing.",
      });
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn’t copy the link. You can copy it from the address bar.");
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
    <div className={cn("grid max-w-full grid-cols-2 items-center gap-2", className)}>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={compact ? "size-11 p-0" : "min-h-11 min-w-0 px-2.5"}
        onClick={share}
        data-testid="share-auction"
        aria-label="Share listing"
        title="Share listing"
      >
        <Share2 aria-hidden />
        {!compact && "Share"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={compact ? "size-11 p-0" : "min-h-11 min-w-0 px-2.5"}
        onClick={copyLink}
        data-testid="copy-auction-link"
        aria-label="Copy listing link"
        title="Copy listing link"
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {!compact && (copied ? "Copied" : "Copy link")}
      </Button>
    </div>
  );
}
