import { exponentFor } from "@/lib/money";
import { isBiddable } from "@/lib/auction-status";

/**
 * JSON-LD for the two places a crawler can learn what BidBlitz sells: the
 * site itself, and an individual auction.
 *
 * The rule for this whole module is "emit only what the page already shows".
 * Structured data that contradicts the visible content is treated by Google as
 * spam, and the cheapest way to guarantee agreement is to build both from the
 * same fields the page renders — same currency maths, same `isBiddable()` the
 * bid panel uses, same canonical URL the `<link rel="canonical">` emits.
 *
 * Deliberately absent, permanently:
 *   - `aggregateRating` / `review` — BidBlitz reviews are per-transaction and
 *     are not product ratings. Publishing a rating count we do not aggregate
 *     would be a fabricated claim.
 *   - `brand`, `sku`, `gtin` — sellers list one-off used and new items; no
 *     brand field exists, so inventing one would be fiction.
 *   - `seller` identity inside the offer — a username is not a schema.org
 *     seller entity, and it is not what a buyer is evaluating at bid time.
 *   - `address` / `sameAs` on the Organization — no office address and no
 *     social accounts have been supplied, and neither may be guessed.
 */
export type JsonLd = Record<string, unknown>;

/** JSON-LD for the site as a whole: Organization + WebSite + site search. */
export function siteStructuredData(siteUrl: string): JsonLd {
  const organization = {
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: "BidBlitz",
    url: siteUrl,
    logo: `${siteUrl}/brand/bidblitz-logo-512.png`,
    description: "BidBlitz is a Zimbabwean online auction marketplace.",
  };

  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: "BidBlitz",
        url: siteUrl,
        publisher: { "@id": `${siteUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${siteUrl}/browse?q={search_string}`,
          },
          "query-input": "required name=search_string",
        },
      },
    ],
  };
}

export type AuctionStructuredInput = {
  siteUrl: string;
  id: string;
  title: string;
  description: string;
  /** Raw auction status — the same value the bid panel receives. */
  status: string;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  currentBidMinor: number | null;
  startingBidMinor: number;
  /** ISO timestamp, or null for an auction with no scheduled close. */
  endsAt: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  /** Absolute cover-image URL, or null when the listing has no photo. */
  imageUrl: string | null;
  /** Injectable so the "still open?" rule is testable without a clock. */
  nowMs?: number;
};

/**
 * Plain decimal string from minor units — `"1234567.89"`, never a symbol and
 * never `Number`. Floating point never touches a price in BidBlitz, and a
 * schema.org `price` is a string anyway.
 */
export function priceString(
  minor: bigint | number | string,
  currency: string
): string {
  const exp = exponentFor(currency);
  const value = BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const digits = abs.toString().padStart(exp + 1, "0");
  const whole = digits.slice(0, digits.length - exp);
  const fraction = exp > 0 ? digits.slice(digits.length - exp) : "";
  return `${negative ? "-" : ""}${whole}${exp > 0 ? `.${fraction}` : ""}`;
}

/** Trimmed for the meta description and the schema description alike. */
function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Product + BreadcrumbList for one auction.
 *
 * `offers` is emitted only while a viewer can actually bid. Once the clock has
 * run out the schema stops claiming availability, so the markup cannot say
 * "InStock" above a page whose own button says bidding is closed.
 */
export function auctionStructuredData(input: AuctionStructuredInput): JsonLd {
  const nowMs = input.nowMs ?? Date.now();
  const url = `${input.siteUrl}/auction/${input.id}`;

  const product: JsonLd = {
    "@type": "Product",
    "@id": `${url}#product`,
    name: input.title,
    url,
  };

  const description = excerpt(input.description);
  if (description) product.description = description;
  if (input.imageUrl) product.image = [input.imageUrl];
  if (input.categoryName) product.category = input.categoryName;

  if (isBiddable(input.status, input.endsAt, nowMs)) {
    const priceMinor =
      input.currentBidMinor !== null
        ? input.currentBidMinor
        : input.startingBidMinor;

    const offer: JsonLd = {
      "@type": "Offer",
      price: priceString(priceMinor, input.currency),
      priceCurrency: input.currency.toUpperCase(),
      availability: "https://schema.org/InStock",
      url,
    };

    // Only claim a validity window while the close is genuinely in the
    // future; an expired date is a stale mark, not a stricter one.
    if (input.endsAt) {
      const endsMs = Date.parse(input.endsAt);
      if (!Number.isNaN(endsMs) && endsMs > nowMs) {
        offer.priceValidUntil = new Date(endsMs).toISOString();
      }
    }

    product.offers = offer;
  }

  const crumbs: JsonLd[] = [
    { position: 1, name: "BidBlitz", item: `${input.siteUrl}/` },
    { position: 2, name: "Browse auctions", item: `${input.siteUrl}/browse` },
  ];
  if (input.categoryName) {
    crumbs.push({
      position: 3,
      name: input.categoryName,
      item: input.categorySlug
        ? `${input.siteUrl}/browse?category=${encodeURIComponent(input.categorySlug)}`
        : `${input.siteUrl}/browse`,
    });
  }
  crumbs.push({
    position: crumbs.length + 1,
    name: input.title,
    item: url,
  });

  return {
    "@context": "https://schema.org",
    "@graph": [
      product,
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs,
      },
    ],
  };
}

/**
 * Serialize for a `<script type="application/ld+json">` tag.
 *
 * JSON.stringify does not escape `/`, so a seller-controlled title of
 * `</script><script>…` would otherwise end the data block and start a new
 * element. `<` and `>` become unicode escapes, which are inert in a script
 * body and still valid JSON once parsed.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}
