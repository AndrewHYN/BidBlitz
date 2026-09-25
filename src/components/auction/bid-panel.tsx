"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gavel, Info, Timer, Trophy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Countdown } from "@/components/auction/countdown";
import { Money } from "@/components/auction/money";
import { TransactionBadge } from "@/components/auction/status-badge";
import { useNow } from "@/components/clock-provider";
import { isBiddable, isClosed } from "@/lib/auction-status";
import { formatMoney, money, nextMinimumBid, parseMoneyToMinor } from "@/lib/money";
import { placeBidAction } from "@/server/actions/bid";
import { renderRejectionMessage, type BidRejection } from "@/server/errors";

/**
 * The bid form and every non-biddable state of an auction.
 *
 * Money rules that apply here:
 *  - the floor is computed with bigint helpers, never with Number arithmetic;
 *  - the server decides whether a bid is accepted — rejections are rendered
 *    verbatim (with the exact number to beat for `below_minimum`);
 *  - one idempotency key per submission attempt, reused only when the same
 *    attempt is retried, so double-clicks and network retries cannot double-bid.
 */

/** Server echoes delivered after a committed bid — the parent mirrors these. */
export type ServerEcho = {
  serverTime: string;
  currentBidMinor: string;
  bidCount: number;
  endsAt: string;
  nextMinMinor: string;
};

/**
 * Rejections where the server may never have seen the request (or refused it
 * before touching state): the SAME requestId must survive a retry so the
 * idempotency key still protects a possible first delivery. Everything else is
 * a validation failure — the attempt ends and the next bid gets a fresh key.
 */
const RETRYABLE_CODES = new Set<string>(["rate_limited", "unknown"]);

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Non-secure contexts: a v4-shaped fallback. This key only de-duplicates
  // retries of one user's bid; it is never treated as a secret.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type BidPanelProps = {
  auctionId: string;
  currency: string;
  /** Live-mirrored values (from the parent's realtime/echo merge). */
  status: string;
  endsAt: string | null;
  currentBidMinor: string | number | null;
  nextMinMinor: string | null;
  /** Static auction facts. */
  startsAt: string | null;
  sellerId: string;
  viewerId: string | null;
  winnerId: string | null;
  winningBidMinor: number | null;
  winningBidderName: string | null;
  startingBidMinor: number;
  bidIncrementMinor: number;
  myHighestBidMinor: number | null;
  transactionStatus: string | null;
  /** Called with the server's response after a committed bid. */
  onServerEcho?: (echo: ServerEcho) => void;
};

export function BidPanel({
  auctionId,
  currency,
  status,
  endsAt,
  currentBidMinor,
  nextMinMinor,
  startsAt,
  sellerId,
  viewerId,
  winnerId,
  winningBidMinor,
  winningBidderName,
  startingBidMinor,
  bidIncrementMinor,
  myHighestBidMinor,
  transactionStatus,
  onServerEcho,
}: BidPanelProps) {
  const router = useRouter();
  const now = useNow();

  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [rejection, setRejection] = useState<BidRejection | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const requestRef = useRef<string | null>(null);

  const scheduled = status === "SCHEDULED";
  const pastEnd = !scheduled && endsAt !== null && Date.parse(endsAt) <= now;
  const settled = isClosed(status);
  // Clock passed but the server has not recorded the outcome yet: never
  // claim a winner (or "no bids") before the settlement says so.
  const pendingSettlement = pastEnd && !settled;
  const closed = settled || pastEnd;
  const biddable = isBiddable(status, endsAt, now);

  /** Guarded bigint comparison — minor units are integers; anything else = unknown. */
  function compareMinor(
    a: string | number | null | undefined,
    b: string | number | null | undefined
  ): number | null {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    try {
      const left = BigInt(a);
      const right = BigInt(b);
      return left === right ? 0 : left > right ? 1 : -1;
    } catch {
      return null;
    }
  }

  const outbidComparison = compareMinor(currentBidMinor, myHighestBidMinor);
  const viewerOutbid = outbidComparison === 1 && !success;
  const viewerLeading = outbidComparison === 0 && myHighestBidMinor !== null;

  /**
   * The floor: computed with the shared bigint helper, then raised to any
   * server-provided minimum (realtime event or action response) if it is
   * higher. Never lowered — the server is the authority on what it accepts.
   */
  const floor = useMemo(() => {
    const computed = nextMinimumBid(
      currentBidMinor === null || currentBidMinor === undefined
        ? null
        : BigInt(currentBidMinor),
      BigInt(startingBidMinor),
      BigInt(bidIncrementMinor)
    );
    if (nextMinMinor === null) return computed;
    try {
      const fromServer = BigInt(nextMinMinor);
      return fromServer > computed ? fromServer : computed;
    } catch {
      return computed;
    }
  }, [currentBidMinor, startingBidMinor, bidIncrementMinor, nextMinMinor]);

  const parsedAmount =
    value.trim() === "" ? null : parseMoneyToMinor(value, currency);

  const errorText = rejection
    ? renderRejectionMessage(rejection, (minor) =>
        formatMoney(money(minor, currency))
      )
    : parseError;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setValue(next);
    setSuccess(false);
    if (next.trim() !== "" && parseMoneyToMinor(next, currency) === null) {
      setParseError(
        `Enter a valid amount, for example ${formatMoney(money(floor, currency))}.`
      );
    } else {
      setParseError(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setRejection(null);
    setSuccess(false);

    const minor = value.trim() === "" ? null : parseMoneyToMinor(value, currency);
    if (minor === null) {
      setParseError(
        value.trim() === ""
          ? "Enter a bid amount."
          : "Enter a valid bid amount."
      );
      // Validation failure: this attempt ends, the next one gets a new key.
      requestRef.current = null;
      return;
    }
    setParseError(null);

    // ONE idempotency key per attempt; a retry of this attempt reuses it.
    const requestId = requestRef.current ?? generateRequestId();
    requestRef.current = requestId;
    setPending(true);

    try {
      const result = await placeBidAction({
        auctionId,
        amountMinor: minor.toString(),
        requestId,
      });

      if (result.ok) {
        // Confirmed success: the next bid is a new attempt.
        requestRef.current = null;
        setValue("");
        setSuccess(true);
        setRejection(null);
        onServerEcho?.({
          serverTime: result.serverTime,
          currentBidMinor: result.currentBidMinor,
          bidCount: result.bidCount,
          endsAt: result.endsAt,
          nextMinMinor: result.nextMinMinor,
        });
        toast.success("Bid placed", {
          description: `You're the highest bidder at ${formatMoney(
            money(result.currentBidMinor, currency)
          )}.`,
        });
        router.refresh();
        return;
      }

      const serverRejection = result.rejection;
      if (!RETRYABLE_CODES.has(serverRejection.code)) {
        requestRef.current = null;
      }
      setRejection(serverRejection);

      if (
        serverRejection.code === "below_minimum" &&
        serverRejection.nextMinMinor !== undefined
      ) {
        // Put the exact number to beat in the input.
        setValue(formatMoney(money(serverRejection.nextMinMinor, currency)));
        setParseError(null);
      }
    } catch {
      // Transport failure: nothing can have committed under an unknown
      // outcome, so the same requestId is kept for the retry.
      setRejection({
        code: "unknown",
        message:
          "We couldn't reach the server — your bid was NOT submitted. Try again.",
      });
    } finally {
      setPending(false);
    }
  }

  // ---------------------------------------------------------------- closed
  if (closed) {
    return (
      <div
        data-testid="auction-closed-panel"
        className="space-y-3 rounded-xl border bg-card p-5"
      >
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="font-semibold">
            {pendingSettlement
              ? "Bidding has closed"
              : winnerId
                ? "Auction ended"
                : "Auction closed"}
          </h2>
        </div>

        {pendingSettlement ? (
          <div role="status" className="space-y-1">
            <p className="font-medium">Recording the final result…</p>
            <p className="text-sm text-muted-foreground">
              {currentBidMinor !== null && currentBidMinor !== undefined ? (
                <>
                  The clock ran out with a top bid of{" "}
                  <Money minor={currentBidMinor} currency={currency} />. The
                  winner is confirmed on the server in a moment.
                </>
              ) : (
                <>The clock ran out with no bids — the auction is closed.</>
              )}
            </p>
          </div>
        ) : winnerId ? (
          <div className="space-y-1">
            <p className="font-medium">
              {viewerId === winnerId
                ? "You won this auction."
                : winningBidderName
                  ? `Winner: ${winningBidderName}`
                  : "This auction has a winner."}
            </p>
            <p className="text-sm text-muted-foreground">
              Winning bid:{" "}
              <Money
                minor={winningBidMinor ?? currentBidMinor}
                currency={currency}
              />
            </p>
          </div>
        ) : status === "CANCELLED" ? (
          <p className="text-sm text-muted-foreground">
            This auction was cancelled.
          </p>
        ) : currentBidMinor === null || currentBidMinor === undefined ? (
          <p className="text-sm text-muted-foreground">
            No bids were placed — this auction closed unsold.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            This auction closed without a sale.
          </p>
        )}

        {transactionStatus && (
          <div className="space-y-2 border-t pt-3">
            <TransactionBadge status={transactionStatus} />
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              No payment provider is configured yet, so no money has moved.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------- scheduled
  if (scheduled) {
    return (
      <div
        data-testid="auction-scheduled-panel"
        className="space-y-3 rounded-xl border bg-card p-5"
      >
        <div className="flex items-center gap-2">
          <Timer className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="font-semibold">Bidding hasn&apos;t opened yet</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          This auction goes live when the countdown reaches zero — then you can
          place your first bid.
        </p>
        <Countdown endsAt={endsAt ?? startsAt} status="SCHEDULED" variant="boxes" />
      </div>
    );
  }

  // ---------------------------------------------------------------- seller
  if (viewerId !== null && viewerId === sellerId) {
    return (
      <div
        data-testid="seller-cannot-bid"
        className="rounded-xl border bg-muted/40 p-5 text-sm text-muted-foreground"
      >
        This is your auction — you can&apos;t bid on it.
      </div>
    );
  }

  // ------------------------------------------------------------- signed out
  if (viewerId === null) {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-5">
        <Button asChild size="lg" className="w-full">
          <Link data-testid="sign-in-to-bid" href={`/login?next=/auction/${auctionId}`}>
            Sign in to bid
          </Link>
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Bidding requires an account so every bid stays attributable.
        </p>
      </div>
    );
  }

  // --------------------------------------------------- non-biddable fallback
  if (!biddable) {
    return (
      <div
        data-testid="auction-closed-panel"
        className="space-y-2 rounded-xl border bg-card p-5"
      >
        <h2 className="font-semibold">Bidding is not open</h2>
        <p className="text-sm text-muted-foreground">
          This auction isn&apos;t accepting bids right now.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------- form
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border bg-card p-5"
      noValidate
    >
      <div className="flex items-center gap-2">
        <Gavel className="size-4 text-primary" aria-hidden />
        <h2 className="font-semibold">Place your bid</h2>
      </div>

      {viewerOutbid && (
        <div
          data-testid="outbid-status"
          role="status"
          className="rounded-lg border border-ending/40 bg-ending/10 px-3 py-2 text-sm"
        >
          You&apos;ve been outbid — the top bid is now{" "}
          <Money minor={currentBidMinor} currency={currency} />. Bid again to
          take the lead.
        </div>
      )}

      {viewerLeading && (
        <div
          data-testid="leading-status"
          role="status"
          className="rounded-lg border border-live/40 bg-live/10 px-3 py-2 text-sm"
        >
          You&apos;re the highest bidder at{" "}
          <Money minor={currentBidMinor} currency={currency} />. The auction is
          still live — anyone can outbid you before the clock runs out.
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="bid-amount">Your bid</Label>
        <div className="flex gap-2">
          <Input
            id="bid-amount"
            data-testid="bid-amount-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={handleChange}
            placeholder={formatMoney(money(floor, currency))}
            disabled={pending}
            aria-invalid={errorText ? true : undefined}
            aria-describedby={errorText ? "bid-error-text" : undefined}
            className="flex-1"
          />
          <Button
            type="submit"
            data-testid="place-bid-button"
            size="lg"
            disabled={pending || parsedAmount === null}
          >
            {pending ? "Bidding…" : "Place bid"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Minimum bid:{" "}
          <Money minor={floor} currency={currency} />
          {myHighestBidMinor !== null && (
            <>
              {" · "}
              Your highest bid:{" "}
              <Money minor={myHighestBidMinor} currency={currency} />
            </>
          )}
        </p>
      </div>

      {errorText && (
        <div
          data-testid="bid-error"
          id="bid-error-text"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {errorText}
        </div>
      )}

      {success && (
        <p
          data-testid="bid-success"
          role="status"
          className="rounded-lg border border-live/40 bg-live/10 px-3 py-2 text-sm"
        >
          Bid placed. The minimum is now{" "}
          <Money minor={floor} currency={currency} />.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Bids are final.{" "}
        <Link
          href="/help/rules"
          className="font-medium text-primary hover:underline"
        >
          Bidding rules
        </Link>{" "}
        ·{" "}
        <Link
          href="/help/fees"
          className="font-medium text-primary hover:underline"
        >
          Fees
        </Link>
      </p>
    </form>
  );
}
