import { isPaymentProviderConfigured } from "@/server/payments/config";
import { feePercentLabel } from "@/lib/money";
import { Money } from "@/components/auction/money";
import { TransactionBadge } from "@/components/auction/status-badge";

/**
 * The honest settlement summary.
 *
 * `settle_auction` records the sale, the fee and the proceeds — it does NOT
 * move money, because no payment provider is wired up. So this never says
 * "paid", never says "complete", and states plainly that nothing has moved
 * while that remains true.
 */
export function SaleSummary({
  transaction,
  feeBps,
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
            Fee{feeBps !== null ? ` (${feePercentLabel(feeBps)})` : ""}
          </dt>
          <dd className="font-medium">
            <Money minor={transaction.fee_minor} currency={transaction.currency} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">You keep</dt>
          <dd className="font-medium">
            <Money minor={transaction.net_minor} currency={transaction.currency} />
          </dd>
        </div>
      </dl>

      {!configured && (
        <p className="mt-3 text-xs text-muted-foreground">
          No payment provider is configured yet, so no money has moved.
        </p>
      )}
    </div>
  );
}
