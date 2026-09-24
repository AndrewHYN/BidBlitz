"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { settleIfDueAction } from "@/server/actions/auction";
import { Button } from "@/components/ui/button";

/**
 * The settle sweep runs from page views and cron, but a seller watching their
 * own auction end shouldn't have to wait for either. This just nudges the same
 * idempotent engine function — it can never settle early (`settle_auction`
 * refuses a LIVE row whose `ends_at` is still in the future).
 */
export function SettleButton({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          try {
            await settleIfDueAction(auctionId);
          } finally {
            router.refresh();
          }
        });
      }}
    >
      {pending ? "Checking…" : "Settle now"}
    </Button>
  );
}
