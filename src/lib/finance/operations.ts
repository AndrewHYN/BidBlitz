import { z } from "zod";

// Finance operations are a bounded, permission-checked DATABASE projection.
// Only intended public-facing names and payment references appear. Wallet IDs,
// phones, payment event payloads and credentials never leave the server.
const minor = z.string().regex(/^-?[0-9]+$/);
const transaction = z.object({
  id: z.string().uuid(),
  status: z.string(),
  provider: z.string().nullable(),
  providerReference: z.string().nullable(),
  grossMinor: minor,
  feeMinor: minor,
  sellerMinor: minor,
  currency: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  auctionTitle: z.string().nullable(),
  buyerName: z.string(),
  sellerName: z.string(),
});
const payout = z.object({
  id: z.string().uuid(),
  transactionId: z.string().uuid(),
  status: z.string(),
  amountMinor: minor,
  currency: z.string(),
  payoutReference: z.string().nullable(),
  paidAt: z.string().nullable(),
  deliveryConfirmedAt: z.string().nullable(),
  updatedAt: z.string(),
  paymentStatus: z.string(),
  grossMinor: minor,
  feeMinor: minor,
  auctionTitle: z.string().nullable(),
  sellerName: z.string(),
  walletReady: z.boolean(),
  hasOpenDispute: z.boolean(),
});
const response = z.object({
  asOf: z.string(),
  limit: z.number().int().min(1).max(100),
  canViewPayments: z.boolean(),
  canViewPayouts: z.boolean(),
  transactions: z.array(transaction),
  payouts: z.array(payout),
});
export type FinanceOperations = z.infer<typeof response>;
export type FinancePayment = FinanceOperations["transactions"][number];
export type FinancePayout = FinanceOperations["payouts"][number];

export function parseFinanceOperations(value: unknown): FinanceOperations | null {
  const result = response.safeParse(value);
  return result.success ? result.data : null;
}

// Never turn an arbitrary bigint into an imprecise JavaScript money amount.
export function safeMinor(value: string): number | null {
  if (!/^-?[0-9]+$/.test(value)) return null;
  try {
    const amount = BigInt(value);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) return null;
    return Number(amount);
  } catch {
    return null;
  }
}

export type PayoutTriage = "paid" | "hold" | "reconcile" | "ready" | "waiting";

export function payoutTriage(row: Pick<FinancePayout,
  "status" | "hasOpenDispute" | "deliveryConfirmedAt" | "paymentStatus" | "walletReady">): PayoutTriage {
  if (row.status === "PAID_OUT") return "paid";
  if (row.hasOpenDispute || row.status === "HELD" || row.status === "DISPUTED") return "hold";
  if (row.status === "PAYOUT_DUE") return "reconcile";
  if (row.deliveryConfirmedAt && ["PAID", "SETTLED"].includes(row.paymentStatus)
      && row.walletReady && ["PAYOUT_PENDING", "DELIVERY_CONFIRMED"].includes(row.status)) return "ready";
  return "waiting";
}

export function paymentEquation(row: Pick<FinancePayment, "grossMinor" | "feeMinor" | "sellerMinor">): boolean {
  return BigInt(row.grossMinor) === BigInt(row.feeMinor) + BigInt(row.sellerMinor);
}

/** A reference on a statement page is evidence to investigate, never proof
 * that a seller wallet has received the money or that a transfer completed. */
export function statementReferenceFound(
  reference: string | null,
  entries: ReadonlyArray<{ id: string }>
): boolean {
  return Boolean(reference && entries.some((entry) => entry.id === reference));
}
