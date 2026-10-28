import { z } from "zod";

const minor = z.string().regex(/^\d+$/);
export const salesBucket = z.enum(["UNVERIFIED", "HELD", "READY", "REVIEW", "PAID_OUT"]);
const entry = z.object({
  id: z.string().uuid(), auctionId: z.string().uuid(), title: z.string().nullable(),
  grossMinor: minor, feeMinor: minor, proceedsMinor: minor,
  createdAt: z.string(), providerReference: z.string().nullable(),
  collectionVerified: z.boolean(), bucket: salesBucket,
});
const account = z.object({
  currency: z.literal("USD"), asOf: z.string(),
  transactionCount: z.number().int().nonnegative(), otherCurrencyCount: z.number().int().nonnegative(),
  grossMinor: minor, feeMinor: minor, proceedsMinor: minor,
  unverifiedMinor: minor, heldMinor: minor, readyMinor: minor, reviewMinor: minor, paidOutMinor: minor,
  entries: z.array(entry).max(100),
}).superRefine((value, ctx) => {
  const buckets = [value.unverifiedMinor, value.heldMinor, value.readyMinor, value.reviewMinor, value.paidOutMinor];
  // Zod can run object refinements after a string-pattern failure. Do not
  // attempt BigInt conversion until every monetary string passed its format.
  const amounts = [value.grossMinor, value.feeMinor, value.proceedsMinor, ...buckets,
    ...value.entries.flatMap((row) => [row.grossMinor, row.feeMinor, row.proceedsMinor])];
  if (amounts.some((amount) => !/^\d+$/.test(amount))) return;
  const proceeds = BigInt(value.proceedsMinor);
  if (BigInt(value.grossMinor) !== BigInt(value.feeMinor) + proceeds
    || buckets.reduce((sum, amount) => sum + BigInt(amount), 0n) !== proceeds
    || value.entries.length > value.transactionCount
    || value.entries.some((row) => BigInt(row.grossMinor) !== BigInt(row.feeMinor) + BigInt(row.proceedsMinor)
      || (row.bucket === "READY" && !row.collectionVerified))
    || new Set(value.entries.map((row) => row.id)).size !== value.entries.length) {
    ctx.addIssue({ code: "custom", message: "Sales ledger does not reconcile." });
  }
});
export type SalesAccount = z.infer<typeof account>;
export type SalesBucket = z.infer<typeof salesBucket>;
export function parseSalesAccount(value: unknown): SalesAccount | null {
  const parsed = account.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export const SALES_BUCKET_LABELS: Record<SalesBucket, string> = {
  UNVERIFIED: "Collection checks", HELD: "Held", READY: "Ready for finance",
  REVIEW: "Under review", PAID_OUT: "Paid to seller",
};

const check = z.object({
  transactionId: z.string().uuid(), verified: z.boolean(), nonLive: z.boolean(),
  settlementReference: z.string().nullable(), verifiedAt: z.string().nullable(),
}).refine((value) => !value.verified || (!value.nonLive && value.settlementReference !== null && value.verifiedAt !== null));
export type CollectionCheck = z.infer<typeof check>;
export function parseCollectionChecks(value: unknown, ids: string[]): CollectionCheck[] | null {
  const parsed = z.array(check).max(100).safeParse(value);
  if (!parsed.success || parsed.data.length !== ids.length
    || new Set(parsed.data.map((row) => row.transactionId)).size !== ids.length
    || parsed.data.some((row) => !ids.includes(row.transactionId))) return null;
  return parsed.data;
}
