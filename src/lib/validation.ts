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

/** Durations offered in the sell flow (seconds). */
export const DURATIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 21600 },
  { label: "12 hours", seconds: 43200 },
  { label: "1 day", seconds: 86400 },
  { label: "3 days", seconds: 259200 },
] as const;

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
  startingBidMinor: minorAmount,
  bidIncrementMinor: minorAmount,
  durationSeconds: z
    .number()
    .int()
    .min(60, "Minimum duration is 60 seconds")
    .max(604800, "Maximum duration is 7 days"),
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
