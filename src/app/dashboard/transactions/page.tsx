import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getTransactions } from "@/server/queries";
import { EmptyState, PageHeader } from "@/components/auction/page-header";
import { Money } from "@/components/auction/money";
import { TransactionBadge } from "@/components/auction/status-badge";
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
import { isPaymentConfigured } from "@/server/payments/provider";

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

export default async function TransactionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/transactions");

  const rows = await getTransactions(user.id);
  const configured = isPaymentConfigured();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Every settled sale you were part of, with the exact fee breakdown."
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
                <TableHead>Fee</TableHead>
                <TableHead>Proceeds</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recorded</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
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
                  </TableCell>
                  <TableCell>
                    <span data-numeric>
                      <Money minor={row.fee_minor} currency={row.currency} />
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({row.fee_bps / 100}% fee)
                    </span>
                  </TableCell>
                  <TableCell className="font-medium" data-numeric>
                    <Money minor={row.net_minor} currency={row.currency} />
                  </TableCell>
                  <TableCell data-testid="transaction-status">
                    <TransactionBadge status={row.status} />
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
              ))}
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
    </div>
  );
}
