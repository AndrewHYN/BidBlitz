import { z } from "zod";

/**
 * Every external boundary validates with Zod before it can reach the database.
 * The database re-validates everything that matters (it is authoritative);
 * these schemas exist to give users precise, field-level errors fast.
 */

export const CONDITIONS = ["new", "like_new", "good", "fair", "poor"] as const;
export const conditionSchema = z.enum(CONDITIONS);

export const conditionLabels: Record<(typeof CONDITIONS)[number], string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  poor: "For parts",
};

/**
 * The controlled vocabulary for ending an auction early. A seller picks one;
 * free text can never smuggle an unlisted meaning into the audit row. Lives
 * here (not in a `"use server"` module) so pages, client components and
 * actions all read the same list: server modules may only export async
 * functions.
 */
export const CANCELLATION_REASONS = [
  "ITEM_UNAVAILABLE",
  "ITEM_DAMAGED",
  "LISTING_ERROR",
  "SELLER_WITHDRAWAL",
  "TECHNICAL_PROBLEM",
  "OTHER",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const cancellationReasonSchema = z.enum(CANCELLATION_REASONS);

export const cancellationReasonLabels: Record<CancellationReason, string> = {
  ITEM_UNAVAILABLE: "Item is no longer available",
  ITEM_DAMAGED: "Item was damaged",
  LISTING_ERROR: "I made an error in the listing",
  SELLER_WITHDRAWAL: "Withdrawing the listing",
  TECHNICAL_PROBLEM: "Technical problem",
  OTHER: "Other",
};

export function cancellationReasonLabel(reason: string): string {
  return (
    cancellationReasonLabels[reason as CancellationReason] ?? "Other"
  );
}

/** Durations offered in the sell flow (seconds). */
export const DURATIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 21600 },
  { label: "12 hours", seconds: 43200 },
  { label: "1 day", seconds: 86400 },
  { label: "3 days", seconds: 259200 },
  { label: "7 days", seconds: 604800 },
  { label: "14 days", seconds: 1209600 },
  { label: "30 days", seconds: 2592000 },
] as const;

/**
 * Minimum password length.
 *
 * One constant for the sign-up form, the password-reset form and the server
 * action, so the three can never disagree about what a valid password is. It
 * lived only as an `if` inside the sign-up form before this, which is how a
 * reset form ends up accepting something the sign-up form would have rejected.
 *
 * It has to live here rather than in the action file: a `"use server"` module
 * may only export async functions, and exporting a number from one breaks the
 * module at request time while every static gate stays green.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Minimum auction starting price, in USD minor units (cents).
 *
 * Linkwa — the production payment provider — publishes $1.00 as the lowest
 * amount it will process. A sale can never win for less than its starting
 * bid, so a starting bid below 100 cents would create an auction whose winner
 * cannot be paid. New auctions are refused below this floor; historical
 * sub-$1 rows predate this rule and are left exactly as they are.
 */
export const MIN_STARTING_BID_MINOR = 100n;

export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/avif", "image/gif",
] as const;

/** Minor-unit strings, because bigint cannot cross a JSON boundary. */
const minorAmount = z
  .string()
  .regex(/^\d{1,15}$/, "Enter an amount")
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, "Amount must be greater than zero");

export const createAuctionSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Title needs at least 3 characters")
    .max(120, "Keep the title under 120 characters"),
  description: z
    .string()
    .trim()
    .min(10, "Describe the item in at least 10 characters")
    .max(5000, "Keep the description under 5000 characters"),
  categoryId: z.coerce.number().int().positive("Pick a category"),
  condition: conditionSchema,
  location: z
    .string()
    .trim()
    .min(2, "Add a location")
    .max(80, "Location is too long"),
  startingBidMinor: minorAmount.refine(
    (v) => v >= MIN_STARTING_BID_MINOR,
    "Minimum starting price is $1.00"
  ),
  bidIncrementMinor: minorAmount,
  durationSeconds: z
    .number()
    .int()
    .min(60, "Minimum duration is 60 seconds")
    .max(2592000, "Maximum duration is 30 days"),
  antiSnipeWindowSeconds: z.number().int().min(0).max(600).default(30),
  antiSnipeExtensionSeconds: z.number().int().min(0).max(600).default(30),
  currency: z.literal("USD").default("USD"),
});

export type CreateAuctionInput = z.infer<typeof createAuctionSchema>;

/**
 * A bid arrives as: which auction, how much (minor units as string), and an
 * idempotency key generated client-side per submission attempt.
 */
export const placeBidSchema = z.object({
  auctionId: z.string().uuid("Invalid auction"),
  amountMinor: minorAmount,
  requestId: z.string().uuid("Invalid request id"),
});

export type PlaceBidInput = z.infer<typeof placeBidSchema>;

export const publishAuctionSchema = z.object({
  auctionId: z.string().uuid("Invalid auction"),
  startsAt: z.string().datetime().optional(),
});

export const watchlistSchema = z.object({
  auctionId: z.string().uuid("Invalid auction"),
  watched: z.boolean(),
});

export const reportSchema = z.object({
  targetType: z.enum(["auction", "user"]),
  targetId: z.string().uuid("Invalid target"),
  reason: z.string().trim().min(5, "Tell us a bit more").max(1000, "Too long"),
});

export const reviewSchema = z.object({
  transactionId: z.string().uuid("Invalid transaction"),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  bio: z.string().trim().max(500).optional().or(z.literal("")),
  location: z.string().trim().max(80).optional().or(z.literal("")),
});

export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * One message in a post-win transaction thread.
 *
 * Length cap is shared by the form, the action and the database CHECK, so
 * the three can never disagree about what a valid message is. 2000 chars is
 * enough to arrange delivery and short enough to keep moderation readable.
 */
export const messageSchema = z.object({
  transactionId: z.string().uuid("Invalid transaction"),
  body: z.string().trim().min(1, "Write a message first.").max(2000, "Keep it under 2000 characters."),
});

export type MessageInput = z.infer<typeof messageSchema>;

// ---------------------------------------------------------------------------
// Discovery / URL state — keeps /browse links shareable
// ---------------------------------------------------------------------------
export const SORTS = [
  { value: "ending-soon", label: "Ending soon" },
  { value: "newest", label: "Newest" },
  { value: "most-bids", label: "Most bids" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
] as const;
export type SortValue = (typeof SORTS)[number]["value"];

export const browseParamsSchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().regex(/^[a-z0-9-]{0,40}$/).optional(),
  condition: conditionSchema.optional(),
  min: z.coerce.number().int().min(0).max(100_000_00).optional(),
  max: z.coerce.number().int().min(0).max(100_000_00).optional(),
  location: z.string().trim().max(80).optional(),
  sort: z.enum(SORTS.map((s) => s.value)).default("ending-soon"),
});

export type BrowseParams = z.infer<typeof browseParamsSchema>;
