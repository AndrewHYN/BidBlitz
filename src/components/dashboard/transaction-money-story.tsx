import {
  Banknote,
  CheckCircle2,
  CircleDashed,
  PackageCheck,
  ShieldAlert,
  WalletCards,
} from "lucide-react";
import { Money } from "@/components/auction/money";
import type { SellerPayoutStatus, TransactionStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

function payoutCopy(status: SellerPayoutStatus | null): string {
  switch (status) {
    case "WAITING_FOR_FULFILMENT":
      return "Waiting for handover";
    case "DELIVERY_CONFIRMED":
      return "Handover confirmed";
    case "PAYOUT_PENDING":
      return "Queued for payout";
    case "PAYOUT_DUE":
      return "Provider reconciliation";
    case "PAID_OUT":
      return "Seller paid";
    case "HELD":
      return "Payout held";
    case "DISPUTED":
      return "Frozen by dispute";
    default:
      return "Not created";
  }
}

export function TransactionMoneyStory({
  currency,
  grossMinor,
  feeMinor,
  netMinor,
  transactionStatus,
  payoutStatus,
  handoverConfirmed,
  hasDispute,
}: {
  currency: string;
  grossMinor: number;
  feeMinor: number;
  netMinor: number;
  transactionStatus: TransactionStatus;
  payoutStatus: SellerPayoutStatus | null;
  handoverConfirmed: boolean;
  hasDispute: boolean;
}) {
  const paid = transactionStatus === "PAID" || transactionStatus === "SETTLED";
  const sellerPaid = payoutStatus === "PAID_OUT";

  const steps = [
    {
      icon: paid ? CheckCircle2 : CircleDashed,
      label: "Buyer payment",
      value: paid ? "Confirmed" : "Waiting",
      done: paid,
      warning: false,
    },
    {
      icon: handoverConfirmed ? PackageCheck : CircleDashed,
      label: "Handover",
      value: handoverConfirmed ? "Confirmed" : "Waiting",
      done: handoverConfirmed,
      warning: false,
    },
    {
      icon: hasDispute ? ShieldAlert : CheckCircle2,
      label: "Case status",
      value: hasDispute ? "Dispute open" : "No open case",
      done: !hasDispute,
      warning: hasDispute,
    },
    {
      icon: sellerPaid ? Banknote : WalletCards,
      label: "Seller payout",
      value: payoutCopy(payoutStatus),
      done: sellerPaid,
      warning: payoutStatus === "HELD" || payoutStatus === "DISPUTED" || payoutStatus === "PAYOUT_DUE",
    },
  ];

  return (
    <section className="money-story rounded-2xl border p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">
            Transaction money
          </p>
          <h2 className="mt-1 text-lg font-bold tracking-tight">
            One sale, three numbers
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The seller payout is frozen from the transaction. BidBlitz never recalculates it later.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sale</p>
            <p className="mt-1 font-bold" data-numeric><Money minor={grossMinor} currency={currency} /></p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">BidBlitz</p>
            <p className="mt-1 font-bold text-primary" data-numeric><Money minor={feeMinor} currency={currency} /></p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Seller</p>
            <p className="mt-1 font-bold" data-numeric><Money minor={netMinor} currency={currency} /></p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-4">
        {steps.map(({ icon: Icon, label, value, done, warning }) => (
          <div
            key={label}
            className={cn(
              "rounded-xl border bg-background/70 p-3 transition",
              done && "border-emerald-500/20",
              warning && "border-amber-500/25 bg-amber-500/5"
            )}
          >
            <Icon
              className={cn(
                "size-4",
                done ? "text-emerald-600" : warning ? "text-amber-600" : "text-muted-foreground"
              )}
              aria-hidden
            />
            <p className="mt-2 text-xs font-semibold text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-sm font-bold">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
