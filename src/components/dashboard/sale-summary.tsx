import { isPaymentProviderConfigured } from "@/server/payments/config";
import { feePercentLabel } from "@/lib/money";
import { Money } from "@/components/auction/money";
import { SellerPayoutBadge, TransactionBadge } from "@/components/auction/status-badge";

/**
 * The honest settlement summary.
 *
 * Two different things live on a sale and must never be collapsed into one
 * badge:
 *
 *   transaction.status — the BUYER's payment, as Paynow reports it.
 *   payout.status      — the SELLER's money: waiting for fulfilment, delivery
 *                        confirmed, payout pending/due, paid out, held, or
 *                        disputed.
 *
 * `settle_auction` records the sale, the fee and the proceeds — it does not
 * move money — so this never says "paid" unless something really is recorded
 * as paid, and the payout line states plainly that the proceeds are a recorded
 * figure, not a transfer.
 */
export function SaleSummary({
  transaction,
  feeBps,
  payout = null,
}: {
  transaction: {
    id: string;
    status: string;
    gross_minor: number;
    fee_minor: number;
    net_minor: number;
    currency: string;
  };
  feeBps: number | null;
  payout?: {
    status: string;
    delivery_confirmed_at: string | null;
    paid_at: string | null;
  } | null;
}) {
  const configured = isPaymentProviderConfigured();

  return (
    <div className="rounded-xl border bg-card p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Sale recorded</span>
        <TransactionBadge status={transaction.status} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Winning price</dt>
          <dd className="font-medium">
            <Money minor={transaction.gross_minor} currency={transaction.currency} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            BidBlitz fee{feeBps !== null ? ` (${feePercentLabel(feeBps)})` : ""}
          </dt>
          <dd className="font-medium">
            <Money minor={transaction.fee_minor} currency={transaction.currency} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Your proceeds</dt>
          <dd className="font-medium">
            <Money minor={transaction.net_minor} currency={transaction.currency} />
          </dd>
        </div>
      </dl>

      {payout ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs"
          data-testid="sale-payout-state"
        >
          <span className="text-muted-foreground">Payout</span>
          <SellerPayoutBadge status={payout.status} />
          <span className="text-muted-foreground">
            {PAYOUT_COPY[payout.status] ?? "Ask us about this sale."}
          </span>
        </div>
      ) : (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          {configured
            ? "Your payout record appears here once Paynow confirms the buyer's payment. Until then these proceeds are recorded, not sent."
            : "No payment provider is configured yet, so no money has moved. These proceeds are recorded, not sent."}
        </p>
      )}
    </div>
  );
}

/**
 * What each payout state means to a seller, in their language — not the
 * operator's. A hold and a dispute both stop payment, so both say so plainly
 * rather than hinting at a problem.
 */
const PAYOUT_COPY: Record<string, string> = {
  WAITING_FOR_FULFILMENT:
    "the buyer has paid; deliver or hand over the item, then we confirm it.",
  DELIVERY_CONFIRMED: "delivery is confirmed; the payout is being prepared.",
  PAYOUT_PENDING: "we are waiting for the payment provider to settle this sale.",
  PAYOUT_DUE: "this payout is ready to be paid to you.",
  PAID_OUT: "paid out.",
  HELD: "held while a dispute is looked into.",
  DISPUTED: "held because a dispute has been raised.",
};
