import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  CONDITIONS,
  DURATIONS,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  SORTS,
  browseParamsSchema,
  createAuctionSchema,
  markNotificationsReadSchema,
  placeBidSchema,
  profileSchema,
  publishAuctionSchema,
  reportSchema,
  reviewSchema,
  watchlistSchema,
} from "./validation";

const UUID = "3f1d2a4c-9b7e-4f0a-8c2d-1e6b5a4f3c2d";

function validAuction() {
  return {
    title: "Vintage camera",
    description: "A lovely film camera in fully working order.",
    categoryId: "7",
    condition: "good",
    location: "Berlin",
    startingBidMinor: "500",
    bidIncrementMinor: "50",
    durationSeconds: 3600,
  };
}

describe("createAuctionSchema", () => {
  it("accepts a valid payload, coerces ids and applies defaults", () => {
    const parsed = createAuctionSchema.safeParse(validAuction());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.categoryId).toBe(7); // string -> number coercion
    expect(parsed.data.startingBidMinor).toBe(500n); // string -> bigint
    expect(parsed.data.bidIncrementMinor).toBe(50n);
    expect(parsed.data.antiSnipeWindowSeconds).toBe(30);
    expect(parsed.data.antiSnipeExtensionSeconds).toBe(30);
    expect(parsed.data.currency).toBe("USD");
  });

  it("rejects a title below 3 characters", () => {
    const parsed = createAuctionSchema.safeParse({ ...validAuction(), title: "ab" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path[0] === "title")).toBe(true);
  });

  it("rejects a description below 10 characters", () => {
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), description: "too short" }).success
    ).toBe(false);
  });

  it("coerces categoryId and rejects non-positive ids", () => {
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), categoryId: 42 }).success
    ).toBe(true);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), categoryId: "0" }).success
    ).toBe(false);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), categoryId: "abc" }).success
    ).toBe(false);
  });

  it("enforces durationSeconds between 60 and 604800", () => {
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), durationSeconds: 60 }).success
    ).toBe(true);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), durationSeconds: 604800 }).success
    ).toBe(true);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), durationSeconds: 59 }).success
    ).toBe(false);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), durationSeconds: 604801 }).success
    ).toBe(false);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), durationSeconds: 60.5 }).success
    ).toBe(false);
  });

  it("rejects a zero starting bid and non-digit amounts", () => {
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), startingBidMinor: "0" }).success
    ).toBe(false);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), bidIncrementMinor: "abc" }).success
    ).toBe(false);
    expect(
      createAuctionSchema.safeParse({ ...validAuction(), bidIncrementMinor: "" }).success
    ).toBe(false);
  });

  it("honours an explicit anti-snipe window", () => {
    const parsed = createAuctionSchema.safeParse({
      ...validAuction(),
      antiSnipeWindowSeconds: 120,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.antiSnipeWindowSeconds).toBe(120);
  });
});

describe("placeBidSchema", () => {
  const valid = { auctionId: UUID, amountMinor: "2500", requestId: UUID };

  it("accepts a well-formed bid", () => {
    const parsed = placeBidSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.amountMinor).toBe(2500n);
  });

  it("rejects a non-UUID requestId", () => {
    const parsed = placeBidSchema.safeParse({ ...valid, requestId: "not-a-uuid" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path[0] === "requestId")).toBe(true);
  });

  it("rejects a non-UUID auctionId", () => {
    expect(placeBidSchema.safeParse({ ...valid, auctionId: "nope" }).success).toBe(false);
  });

  it("rejects non-numeric and zero amounts", () => {
    expect(placeBidSchema.safeParse({ ...valid, amountMinor: "abc" }).success).toBe(false);
    expect(placeBidSchema.safeParse({ ...valid, amountMinor: "0" }).success).toBe(false);
    expect(placeBidSchema.safeParse({ ...valid, amountMinor: "" }).success).toBe(false);
    expect(placeBidSchema.safeParse({ ...valid, amountMinor: "1.5" }).success).toBe(false);
  });
});

describe("browseParamsSchema", () => {
  it("defaults sort to ending-soon", () => {
    const parsed = browseParamsSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sort).toBe("ending-soon");
  });

  it("accepts every documented sort value", () => {
    for (const sort of SORTS.map((s) => s.value)) {
      const parsed = browseParamsSchema.safeParse({ sort });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.sort).toBe(sort);
    }
  });

  it("rejects an unknown sort", () => {
    expect(browseParamsSchema.safeParse({ sort: "cheapest" }).success).toBe(false);
  });

  it("coerces numeric bounds and rejects unknown conditions", () => {
    const parsed = browseParamsSchema.safeParse({ min: "100", max: "50000", condition: "new" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.min).toBe(100);
      expect(parsed.data.max).toBe(50000);
      expect(parsed.data.condition).toBe("new");
    }
    expect(browseParamsSchema.safeParse({ condition: "mint" }).success).toBe(false);
  });
});

describe("reportSchema", () => {
  const base = { targetType: "auction", targetId: UUID, reason: "Stolen item" };

  it("accepts a five-character reason", () => {
    expect(reportSchema.safeParse({ ...base, reason: "spam?" }).success).toBe(true);
    expect(reportSchema.safeParse({ ...base, reason: "Stolen item" }).success).toBe(true);
  });

  it("rejects a reason shorter than five characters", () => {
    expect(reportSchema.safeParse({ ...base, reason: "abcd" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, reason: "  abcd  " }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
  });

  it("rejects unknown targets", () => {
    expect(reportSchema.safeParse({ ...base, targetType: "comment" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...base, targetId: "nope" }).success).toBe(false);
  });
});

describe("profileSchema", () => {
  it("accepts display names up to 60 characters", () => {
    expect(profileSchema.safeParse({ displayName: "Ada" }).success).toBe(true);
    expect(profileSchema.safeParse({ displayName: "A".repeat(60) }).success).toBe(true);
    expect(
      profileSchema.safeParse({ displayName: "Ada", bio: "Hello there", location: "Lisbon" })
        .success
    ).toBe(true);
  });

  it("rejects empty and over-long display names", () => {
    expect(profileSchema.safeParse({ displayName: "" }).success).toBe(false);
    expect(profileSchema.safeParse({ displayName: "   " }).success).toBe(false);
    expect(profileSchema.safeParse({ displayName: "A".repeat(61) }).success).toBe(false);
  });

  it("limits the bio to 500 characters", () => {
    expect(profileSchema.safeParse({ displayName: "Ada", bio: "x".repeat(500) }).success).toBe(
      true
    );
    expect(profileSchema.safeParse({ displayName: "Ada", bio: "x".repeat(501) }).success).toBe(
      false
    );
  });
});

describe("publishAuctionSchema", () => {
  it("requires a UUID and accepts an optional ISO start time", () => {
    expect(publishAuctionSchema.safeParse({ auctionId: UUID }).success).toBe(true);
    expect(publishAuctionSchema.safeParse({ auctionId: "nope" }).success).toBe(false);
    expect(
      publishAuctionSchema.safeParse({ auctionId: UUID, startsAt: "2026-09-24T10:00:00.000Z" })
        .success
    ).toBe(true);
    expect(
      publishAuctionSchema.safeParse({ auctionId: UUID, startsAt: "tomorrow" }).success
    ).toBe(false);
  });
});

describe("watchlistSchema", () => {
  it("requires a UUID and a boolean flag", () => {
    expect(watchlistSchema.safeParse({ auctionId: UUID, watched: true }).success).toBe(true);
    expect(watchlistSchema.safeParse({ auctionId: "x", watched: true }).success).toBe(false);
    expect(watchlistSchema.safeParse({ auctionId: UUID, watched: "yes" }).success).toBe(false);
  });
});

describe("reviewSchema", () => {
  const transactionId = UUID;

  it("bounds the rating at 1..5 integers", () => {
    expect(reviewSchema.safeParse({ transactionId, rating: 1 }).success).toBe(true);
    expect(reviewSchema.safeParse({ transactionId, rating: 5 }).success).toBe(true);
    expect(reviewSchema.safeParse({ transactionId, rating: 0 }).success).toBe(false);
    expect(reviewSchema.safeParse({ transactionId, rating: 6 }).success).toBe(false);
    expect(reviewSchema.safeParse({ transactionId, rating: 4.5 }).success).toBe(false);
  });
});

describe("markNotificationsReadSchema", () => {
  it("accepts between 1 and 200 uuids", () => {
    expect(markNotificationsReadSchema.safeParse({ ids: [UUID] }).success).toBe(true);
    expect(markNotificationsReadSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(
      markNotificationsReadSchema.safeParse({
        ids: Array.from({ length: 201 }, () => UUID),
      }).success
    ).toBe(false);
  });
});

describe("exported constants", () => {
  it("publishes the documented media limits", () => {
    expect(MAX_IMAGES).toBe(8);
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect([...ALLOWED_IMAGE_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/gif",
    ]);
  });

  it("publishes the documented conditions and durations", () => {
    expect([...CONDITIONS]).toEqual(["new", "like_new", "good", "fair", "poor"]);
    expect(DURATIONS.map((d) => d.seconds)).toEqual([
      3600, 21600, 43200, 86400, 259200,
    ]);
  });
});
