/**
 * Money — integer minor units ONLY.
 *
 * The single rule of this module: a monetary value is `{ minor: bigint,
 * currency: string }` or it does not exist. Floating point never touches a
 * price, a fee or a total anywhere in BidBlitz.
 *
 * Storage example: $399.00 -> { minor: 39900n, currency: "USD" }
 */

export type Money = { readonly minor: bigint; readonly currency: string };

/** Currencies we render, with their exponent (minor units per major unit). */
const EXPONENTS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, JPY: 0, KRW: 0,
};

export function exponentFor(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

export function money(minor: bigint | number | string, currency = "USD"): Money {
  return { minor: BigInt(minor), currency: currency.toUpperCase() };
}

/**
 * Format for display. Never uses Number() on the value — Number would lose
 * precision above 2^53 and, worse, invite float arithmetic downstream.
 */
export function formatMoney(m: Money, opts: { compact?: boolean } = {}): string {
  const exp = exponentFor(m.currency);
  const negative = m.minor < 0n;
  const abs = negative ? -m.minor : m.minor;

  const asString = abs.toString().padStart(exp + 1, "0");
  const whole = asString.slice(0, asString.length - exp);
  const fraction = exp > 0 ? asString.slice(asString.length - exp) : "";

  const grouped = opts.compact
    ? whole
    : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const body = exp > 0 ? `${grouped}.${fraction}` : grouped;
  return `${negative ? "-" : ""}${symbolFor(m.currency)}${body}`;
}

/** "$" style symbol, falling back to the ISO code. */
export function symbolFor(currency: string): string {
  const c = currency.toUpperCase();
  const symbols: Record<string, string> = {
    USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$", JPY: "¥", KRW: "₩",
  };
  return symbols[c] ?? `${c} `;
}

/**
 * Parse user input ("410", "410.50", "$1,000") into minor units.
 * Returns null when the input is not a valid amount — callers surface a
 * field error rather than silently coercing.
 *
 * Division uses string math: `410.5 * 100` is 41049.999999999996 in float,
 * which would round to the wrong price.
 */
export function parseMoneyToMinor(input: string, currency = "USD"): bigint | null {
  const exp = exponentFor(currency);
  const cleaned = input.replace(/[\s,]/g, "").replace(/^\$/, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > exp) return null;           // no sub-minor-unit precision

  const padded = fraction.padEnd(exp, "0");
  return BigInt(whole + padded);
}

/** Next minimum bid: first bid is the floor, later bids add the increment. */
export function nextMinimumBid(
  currentBidMinor: bigint | null,
  startingBidMinor: bigint,
  incrementMinor: bigint
): bigint {
  return currentBidMinor === null
    ? startingBidMinor
    : currentBidMinor + incrementMinor;
}

/**
 * Platform fee, server-side mirror of public.round_minor().
 * Kept for display-only previews; the authoritative value is computed in SQL
 * and persisted on the transaction row. Half-up rounding, integer math.
 */
export function previewFeeMinor(
  grossMinor: bigint,
  feeBps: number,
  minFeeMinor = 0n
): bigint {
  const numerator = grossMinor * BigInt(feeBps);
  const halfUp = (numerator + 5000n) / 10000n;
  const fee = halfUp > minFeeMinor ? halfUp : minFeeMinor;
  return fee > grossMinor ? grossMinor : fee;
}

/**
 * Human label for a basis-point rate: 500 -> "5%", 1250 -> "12.5%",
 * 333 -> "3.33%". BigInt-only — no float division anywhere near a fee,
 * and the truncation is deterministic (bps values are integers by schema).
 */
export function feePercentLabel(feeBps: number): string {
  const bps = BigInt(feeBps);
  const whole = bps / 100n;
  const frac = bps % 100n;
  if (frac === 0n) return `${whole}%`;
  const digits = frac.toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole}.${digits}%`;
}
