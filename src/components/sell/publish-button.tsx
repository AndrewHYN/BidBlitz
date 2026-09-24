"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { publishAuctionAction } from "@/server/actions/auction";
import { Countdown } from "@/components/auction/countdown";
import { Button } from "@/components/ui/button";
import { isClosed } from "@/lib/auction-status";
import { formatMoney, money } from "@/lib/money";
import { renderRejectionMessage } from "@/server/errors";

/**
 * Publish gate.
 *
 * The database is the authority: `publish_auction` refuses any auction with
 * `image_count < 1`, so the button mirrors that rule instead of waiting to be
 * told off. Once the engine accepts, the button is replaced by a countdown —
 * there is nothing left to click.
 */
export function PublishButton({
  auctionId,
  imageCount,
  status,
  endsAt,
}: {
  auctionId: string;
  imageCount: number;
  status: string;
  endsAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePublish() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await publishAuctionAction({ auctionId });
        if (!result.ok) {
          setError(renderRejectionMessage(result.rejection, (minor) => formatMoney(money(minor))));
          return;
        }
        setLaunched(true);
        router.refresh();
      } catch {
        setError("Something went wrong while publishing. Please try again.");
      }
    });
  }

  if (status !== "DRAFT" || launched) {
    const label = isClosed(status)
      ? status === "CANCELLED"
        ? "This auction was cancelled"
        : "This auction is closed"
      : status === "SCHEDULED"
        ? "Scheduled — waiting for the clock to start"
        : "Live now";

    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Rocket className="size-4 text-primary" aria-hidden />
          {label}
        </p>
        {endsAt && <Countdown endsAt={endsAt} status={status} variant="boxes" />}
        <Button asChild variant="outline" size="sm">
          <Link href={`/auction/${auctionId}`}>View the live listing</Link>
        </Button>
      </div>
    );
  }

  const blocked = imageCount < 1;

  return (
    <div className="space-y-3">
      <Button
        type="button"
        onClick={handlePublish}
        disabled={blocked || pending}
        aria-describedby={blocked ? "publish-disabled-reason" : undefined}
        data-testid="publish-button"
      >
        <Rocket className="size-4" aria-hidden />
        {pending ? "Publishing…" : "Publish auction"}
      </Button>

      {blocked && (
        <p
          id="publish-disabled-reason"
          data-testid="publish-disabled-reason"
          className="text-sm text-muted-foreground"
        >
          Add at least one photo before publishing.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Publishing starts bidding immediately and runs for the duration you chose. Terms are
        locked from that moment on.
      </p>
    </div>
  );
}
