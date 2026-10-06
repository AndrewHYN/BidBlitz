import { describe, expect, it } from "vitest";
import {
  auctionStructuredData,
  priceString,
  serializeJsonLd,
  siteStructuredData,
  type AuctionStructuredInput,
  type JsonLd,
} from "./structured-data";

const SITE = "https://bidblitz.co.zw";
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

function iso(deltaMs: number): string {
  return new Date(NOW + deltaMs).toISOString();
}

function base(overrides: Partial<AuctionStructuredInput> = {}): AuctionStructuredInput {
  return {
    siteUrl: SITE,
    id: "b44c3c45-8186-4eb1-98c8-db4b9a6d7c58",
    title: "HP EliteBook 840 G7, i5, 16GB RAM, 512GB SSD",
    description: "Used daily for two years. Charged, wiped, box included.",
    status: "LIVE",
    currency: "USD",
    currentBidMinor: 14500,
    startingBidMinor: 10000,
    endsAt: iso(60 * 60_000),
    categoryName: "Computers & Laptops",
    categorySlug: "computers-laptops",
    imageUrl: "https://cdn.example.com/auction/cover.jpg",
    nowMs: NOW,
    ...overrides,
  };
}

function nodes(data: JsonLd): JsonLd[] {
  return data["@graph"] as JsonLd[];
}

function byType(data: JsonLd, type: string): JsonLd {
  const found = nodes(data).find((node) => node["@type"] === type);
  if (!found) throw new Error(`no ${type} node emitted`);
  return found;
}

describe("priceString()", () => {
  it("formats minor units as a plain decimal, never a float", () => {
    expect(priceString(1000, "USD")).toBe("10.00");
    expect(priceString(950, "USD")).toBe("9.50");
    expect(priceString(1, "USD")).toBe("0.01");
    expect(priceString(0, "USD")).toBe("0.00");
  });

  it("keeps precision a Number would lose", () => {
    // 2^53 + 1 minor units. The same value written as a number literal would
    // already be rounded by the parser before priceString ever saw it, so it
    // has to arrive the way Postgres hands it back: as a string.
    expect(priceString("9007199254740993", "USD")).toBe("90071992547409.93");
    expect(priceString(123456789, "USD")).toBe("1234567.89");
  });

  it("respects the currency exponent", () => {
    expect(priceString(500, "JPY")).toBe("500");
    expect(priceString(500, "jpy")).toBe("500");
    expect(priceString(5, "EUR")).toBe("0.05");
  });
});

describe("auctionStructuredData() — offers", () => {
  it("emits an in-stock offer at the current bid while the auction is open", () => {
    const offer = byType(auctionStructuredData(base()), "Product").offers as JsonLd;

    expect(offer["@type"]).toBe("Offer");
    expect(offer.price).toBe("145.00");
    expect(offer.priceCurrency).toBe("USD");
    expect(offer.availability).toBe("https://schema.org/InStock");
    expect(offer.url).toBe(`${SITE}/auction/b44c3c45-8186-4eb1-98c8-db4b9a6d7c58`);
    expect(offer.priceValidUntil).toBe(iso(60 * 60_000));
  });

  it("falls back to the starting bid when nothing has been bid", () => {
    const offer = byType(
      auctionStructuredData(base({ currentBidMinor: null })),
      "Product"
    ).offers as JsonLd;

    expect(offer.price).toBe("100.00");
  });

  it("never publishes a priceValidUntil that has already expired", () => {
    // isBiddable() already refuses a LIVE auction past its close, so the only
    // state that reaches here with a close in the past is SCHEDULED, which is
    // open regardless of its end time. The offer exists; the stale window must
    // not travel with it.
    const offer = byType(
      auctionStructuredData(base({ status: "SCHEDULED", endsAt: iso(-1_000) })),
      "Product"
    ).offers as JsonLd;

    expect(offer).toBeDefined();
    expect(offer.priceValidUntil).toBeUndefined();
  });

  it("omits priceValidUntil when the auction has no scheduled close", () => {
    const offer = byType(
      auctionStructuredData(base({ endsAt: null })),
      "Product"
    ).offers as JsonLd;

    expect(offer).toBeDefined();
    expect(offer.priceValidUntil).toBeUndefined();
  });

  it.each(["SOLD", "UNSOLD", "ENDED", "CANCELLED", "DRAFT", "PAUSED"])(
    "omits offers entirely for a %s auction",
    (status) => {
      const product = byType(
        auctionStructuredData(base({ status, endsAt: iso(60 * 60_000) })),
        "Product"
      );
      expect(product.offers).toBeUndefined();
    }
  );

  it("omits offers for a LIVE auction whose clock has already run out", () => {
    // The bid panel refuses a bid here via isBiddable(); the schema must not
    // advertise availability above a page whose button says bidding is closed.
    const product = byType(
      auctionStructuredData(base({ status: "LIVE", endsAt: iso(-1) })),
      "Product"
    );
    expect(product.offers).toBeUndefined();
  });
});

describe("auctionStructuredData() — never fabricates", () => {
  const forbidden = [
    "aggregateRating",
    "review",
    "ratingValue",
    "reviewCount",
    "brand",
    "sku",
    "gtin",
    "seller",
    "itemCondition",
  ] as const;

  it.each(forbidden)("never emits %s", (key) => {
    const product = byType(auctionStructuredData(base()), "Product");
    expect(product[key]).toBeUndefined();
    expect(JSON.stringify(product)).not.toContain(key);
  });

  it("omits empty optional fields rather than emitting placeholders", () => {
    const product = byType(
      auctionStructuredData(
        base({ description: "", categoryName: null, imageUrl: null })
      ),
      "Product"
    );

    expect(product.description).toBeUndefined();
    expect(product.category).toBeUndefined();
    expect(product.image).toBeUndefined();
    expect(product.offers).toBeDefined(); // still biddable, so still an offer
  });

  it("keeps the description excerpt within the meta limit", () => {
    const long = "word ".repeat(80).trim();
    const product = byType(auctionStructuredData(base({ description: long })), "Product");
    const description = product.description as string;

    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.endsWith("…")).toBe(true);
    expect(description).not.toContain("  ");
  });
});

describe("auctionStructuredData() — breadcrumbs", () => {
  it("walks Home / Browse / Category / listing with sequential positions", () => {
    const crumb = byType(auctionStructuredData(base()), "BreadcrumbList");
    const items = crumb.itemListElement as JsonLd[];

    expect(items.map((i) => i.name)).toEqual([
      "BidBlitz",
      "Browse auctions",
      "Computers & Laptops",
      "HP EliteBook 840 G7, i5, 16GB RAM, 512GB SSD",
    ]);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(items[2].item).toBe(`${SITE}/browse?category=computers-laptops`);
    expect(items[3].item).toBe(
      `${SITE}/auction/b44c3c45-8186-4eb1-98c8-db4b9a6d7c58`
    );
  });

  it("drops the category crumb when the auction has none", () => {
    const crumb = byType(
      auctionStructuredData(base({ categoryName: null, categorySlug: null })),
      "BreadcrumbList"
    );
    const items = crumb.itemListElement as JsonLd[];

    expect(items).toHaveLength(3);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it("encodes a category slug that needs it", () => {
    const crumb = byType(
      auctionStructuredData(base({ categorySlug: "phones & tablets" })),
      "BreadcrumbList"
    );
    const items = crumb.itemListElement as JsonLd[];

    expect(items[2].item).toBe(`${SITE}/browse?category=phones%20%26%20tablets`);
  });
});

describe("siteStructuredData()", () => {
  const data = siteStructuredData(SITE);

  it("declares Organization and WebSite linked by publisher", () => {
    const [organization, website] = nodes(data);

    expect(organization["@type"]).toBe("Organization");
    expect(website["@type"]).toBe("WebSite");
    expect(website.publisher).toEqual({ "@id": `${SITE}/#organization` });
    expect(organization.url).toBe(SITE);
    expect(organization.logo).toBe(`${SITE}/brand/bidblitz-logo-512.png`);
  });

  it("offers a site search that targets the real browse route", () => {
    const action = (nodes(data)[1].potentialAction ?? {}) as JsonLd;
    expect(action["@type"]).toBe("SearchAction");
    expect((action.target as JsonLd).urlTemplate).toBe(`${SITE}/browse?q={search_string}`);
  });

  it.each(["address", "sameAs", "foundingDate", "taxID", "vatID"])(
    "never guesses %s",
    (key) => {
      expect(JSON.stringify(data)).not.toContain(`"${key}"`);
    }
  );
});

describe("serializeJsonLd()", () => {
  it("neutralises a seller-controlled closing script tag", () => {
    const encoded = serializeJsonLd(
      auctionStructuredData(base({ title: "</script><script>alert(1)</script>" }))
    );

    expect(encoded).not.toContain("</script>");
    expect(encoded).not.toContain("<");
    expect(encoded).toContain("\\u003c");
    // Still a parseable document with the original text intact.
    expect((JSON.parse(encoded) as { "@graph": JsonLd[] })["@graph"]).toHaveLength(2);
    expect(
      ((JSON.parse(encoded) as { "@graph": JsonLd[] })["@graph"][0] as JsonLd).name
    ).toBe("</script><script>alert(1)</script>");
  });

  it("round-trips ordinary content unchanged", () => {
    const data = auctionStructuredData(base());
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
