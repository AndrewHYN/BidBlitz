import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMessageUnreadCounts, getMySellerPayouts, getTransactions } from "@/server/queries";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Money } from "@/components/auction/money";
import { feePercentLabel } from "@/lib/money";
import { SellerPayoutBadge, TransactionBadge } from "@/components/auction/status-badge";
import { ReviewDialog } from "@/components/dashboard/review-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  isPaymentProviderConfigured,
  paymentProviderDisplayName,
  paymentProviderSupportsReconciliation,
} from "@/server/payments/config";
import { PayButton } from "@/components/dashboard/pay-button";
import { CheckStatusButton } from "@/components/dashboard/check-status-button";
import { ConfirmDeliveryButton } from "@/components/dashboard/confirm-delivery-button";
import { paymentsRuntimeEnabled } from "@/server/payments/runtime";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Settled sales you were part of, with the exact fee breakdown.",
  robots: { index: false, follow: false },
};

/** Rendered server-side once, so the row never re-formats during hydration. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Deadlines need a time, not just a day: "Pay by" without one is a guess. */
function formatDeadline(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function TransactionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/transactions");

  const [rows, payouts, unread, payoutStatesRes, paymentsEnabled] = await Promise.all([
    getTransactions(user.id),
    getMySellerPayouts(),
    getMessageUnreadCounts(user.id),
    supabase.rpc("my_transaction_payout_states"),
    paymentsRuntimeEnabled(),
  ]);
  const configured = isPaymentProviderConfigured();
  const canReconcile = paymentProviderSupportsReconciliation();
  // When no provider is connected the copy names the role, never a provider
  // this deployment does not actually use.
  const providerName = configured
    ? paymentProviderDisplayName()
    : "the payment provider";
  // Payment status and payout status are two different records on purpose:
  // "Paid" is the payment provider's word about the buyer, the payout is our
  // word about the seller. Collapsing them is how a marketplace talks itself
  // into a lie.
  const payoutByTx = new Map(payouts.map((p) => [p.transaction_id, p]));
  const partyPayoutByTx = new Map(
    (payoutStatesRes.data ?? []).map((p) => [p.transaction_id, p])
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity & payments"
        description={`Wins and sales after the auction closes: payment, messages, seller payout and reviews. Buyers pay the winning bid plus ${providerName}'s payment charge; sellers receive the winning bid less BidBlitz's 5% fee.`}
      />

      <div>
        {rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No transactions yet"
            description="A row appears here as soon as an auction you won or sold settles."
            action={
              <Button asChild>
                <Link href="/dashboard/selling">Go to selling</Link>
              </Button>
            }
          />
        ) : (
          <Table data-testid="transactions-table">
            <TableHeader>
              <TableRow>
                <TableHead>Auction</TableHead>
                <TableHead>Your side</TableHead>
                <TableHead>Winning price</TableHead>
                <TableHead>BidBlitz fee</TableHead>
                <TableHead>Seller proceeds</TableHead>
                <TableHead>Payment status</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Recorded</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const payout = payoutByTx.get(row.id);
                const partyPayout = partyPayoutByTx.get(row.id);
                return (
                <TableRow key={row.id} data-testid="transaction-row">
                  <TableCell className="max-w-[16rem] truncate whitespace-normal">
                    <Link
                      href={`/auction/${row.auction_id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {row.auctions?.title ?? "Auction"}
                    </Link>
                  </TableCell>
                  <TableCell>{row.seller_id === user.id ? "Seller" : "Buyer"}</TableCell>
                  <TableCell data-numeric>
                    <Money minor={row.gross_minor} currency={row.currency} />
                    {/* A buyer paid this PLUS the payment provider's own payment
                        charge, which the provider calculates and shows on its
                        checkout page — we do not store it, so it must never be
                        implied to be included in the number above. */}
                    {row.buyer_id === user.id && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        plus {providerName}&apos;s charge
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span data-numeric>
                      <Money minor={row.fee_minor} currency={row.currency} />
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({feePercentLabel(row.fee_bps)} taken from the sale)
                    </span>
                  </TableCell>
                  <TableCell className="font-medium" data-numeric>
                    {/* A buyer reading their own purchase sees a net figure in
                        this column, and "Seller proceeds $23.75" next to a price
                        of $25.00 is easy to misread as money coming their way.
                        The header names the seller, but a column of bare
                        numbers reads faster than a header, so the cell carries
                        the qualifier too. */}
                    {row.seller_id === user.id ? (
                      <Money minor={row.net_minor} currency={row.currency} />
                    ) : (
                      <>
                        <span className="text-xs font-normal text-muted-foreground">
                          seller&apos;s
                        </span>{" "}
                        <Money minor={row.net_minor} currency={row.currency} />
                      </>
                    )}
                    {/* The payout is a separate record from the payment, and it
                        is what actually answers "have I been paid?". Showing it
                        only for the selling side avoids implying a buyer has a
                        payout at all. */}
                    {row.seller_id === user.id && payout && (
                      <span
                        className="mt-1 block"
                        data-testid="transaction-payout-status"
                      >
                        <SellerPayoutBadge status={payout.status} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell data-testid="transaction-status">
                    <div className="flex flex-wrap items-center gap-2">
                      <TransactionBadge status={row.status} />
                      {/* The buyer's only route to the provider, and only when
                          one exists: an unconfigured deployment must not show
                          a button that leads to a 503. */}
                      {configured &&
                        paymentsEnabled &&
                        row.buyer_id === user.id &&
                        row.status === "AWAITING_PAYMENT" && (
                          <PayButton transactionId={row.id} providerName={providerName} />
                        )}
                      {/* Both sides may ask the server to reconcile a payment
                          that is still waiting — the answer always comes back
                          from Postgres, never from this page. */}
                      {configured && paymentsEnabled && canReconcile && row.status === "AWAITING_PAYMENT" && (
                        <CheckStatusButton transactionId={row.id} providerName={providerName} />
                      )}
                    </div>
                    {/* The deadline is public marketplace policy: the winner
                        pays within the window or the sale expires and the
                        seller relists. Expired and failed sales state plainly
                        that no money moved, and offer nothing that is not
                        wired: checkout refuses both states server-side. */}
                    {configured && !paymentsEnabled && row.status === "AWAITING_PAYMENT" && (
                      <span className="mt-1 block text-xs font-medium text-primary">
                        Payments are temporarily paused. Nothing can be charged right now.
                      </span>
                    )}
                    {row.status === "AWAITING_PAYMENT" && row.payment_due_at && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {row.buyer_id === user.id ? "Pay by " : "Due "}
                        {formatDeadline(row.payment_due_at)}
                      </span>
                    )}
                    {row.status === "EXPIRED" && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        The payment window lapsed. No money moved. The seller
                        can list the item again.
                      </span>
                    )}
                    {row.status === "FAILED" && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Payment was not completed. No money moved.
                      </span>
                    )}
                    {row.buyer_id === user.id &&
                      (row.status === "PAID" || row.status === "SETTLED") &&
                      partyPayout &&
                      !["HELD", "DISPUTED"].includes(partyPayout.payout_status) && (
                        <div className="mt-2">
                          <ConfirmDeliveryButton
                            transactionId={row.id}
                            confirmed={Boolean(partyPayout.delivery_confirmed_at)}
                          />
                        </div>
                      )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/transactions/${row.id}`}
                      data-testid="message-link"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Messages
                      {(unread.get(row.id) ?? 0) > 0 && (
                        <span
                          data-testid="message-unread"
                          className="ml-1.5 inline-grid size-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground"
                        >
                          {unread.get(row.id)}
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.created_at)}</TableCell>
                  <TableCell>
                    {row.reviewed ? (
                      <span
                        data-testid="review-submitted"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                      >
                        <Check className="size-3.5" aria-hidden />
                        Reviewed
                      </span>
                    ) : (
                      <ReviewDialog
                        transactionId={row.id}
                        auctionTitle={row.auctions?.title ?? "this auction"}
                        counterpartyRole={
                          row.seller_id === user.id ? "buyer" : "seller"
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {!configured && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No payment provider is configured yet, so no money has moved. These rows record what is
          owed, not what has been paid.
        </p>
      )}

      {configured && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Payment status</strong> is the
          buyer&apos;s payment, as {providerName} reports it. <strong className="text-foreground">Payout status</strong>{" "}
          is the seller&apos;s proceeds, tracked separately: it appears only on
          sales you sold, and reaching &ldquo;Paid out&rdquo; means an
          administrator sent the payout or recorded a transfer made outside
          BidBlitz. {providerName} reports the buyer&apos;s payment, not the payout.
        </p>
      )}
    </div>
  );
}
