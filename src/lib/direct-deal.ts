import { formatMoney, parseMoneyToMinor } from "@/lib/money";

export const MIN_DIRECT_OFFER_MINOR = 100n;
export const MAX_DIRECT_OFFER_MINOR = 999999999999999n;

export type OfferPreset = {
  id: "below" | "asking" | "above";
  label: string;
  description: string;
  minor: bigint;
};

/** Rounded in cents using integers so a $160 listing becomes $144/$160/$168. */
export function saleOfferPresets(askingMinor: bigint): OfferPreset[] {
  if (askingMinor < MIN_DIRECT_OFFER_MINOR || askingMinor > MAX_DIRECT_OFFER_MINOR) return [];
  const discount = (askingMinor * 90n + 50n) / 100n;
  const premium = (askingMinor * 105n + 50n) / 100n;
  return [
    ...(discount >= MIN_DIRECT_OFFER_MINOR && discount < askingMinor
      ? [{ id: "below" as const, label: "10% below", description: "Save 10%", minor: discount }] : []),
    { id: "asking" as const, label: "Asking price", description: "Listed price", minor: askingMinor },
    ...(premium > askingMinor && premium <= MAX_DIRECT_OFFER_MINOR
      ? [{ id: "above" as const, label: "5% above", description: "Show strong interest", minor: premium }] : []),
  ];
}

export function customOfferMinor(input: string): bigint | null {
  const value = parseMoneyToMinor(input);
  return value !== null && value >= MIN_DIRECT_OFFER_MINOR && value <= MAX_DIRECT_OFFER_MINOR
    ? value : null;
}

export type ServiceRequestFields = {
  description: string;
  preferredDate?: string;
  location?: string;
  budget?: string;
  currency?: string;
};

/**
 * The existing service RPC accepts one description, not structured columns.
 * Package optional information into that description instead of inventing a
 * server-side quote, booking, payment or new table.
 */
export function composeServiceRequest(input: ServiceRequestFields): string | null {
  const description = input.description.trim();
  const location = input.location?.trim() ?? "";
  const date = input.preferredDate?.trim() ?? "";
  const budget = input.budget?.trim() ?? "";
  if (description.length < 10 || description.length > 1500 || location.length > 120) return null;
  if (date) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return null;
    const parsed = new Date(date + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  }

  let budgetLabel: string | null = null;
  if (budget) {
    const minor = parseMoneyToMinor(budget, input.currency ?? "USD");
    if (minor === null || minor < MIN_DIRECT_OFFER_MINOR || minor > MAX_DIRECT_OFFER_MINOR) return null;
    budgetLabel = formatMoney({ minor, currency: input.currency ?? "USD" });
  }

  const lines = [
    description,
    ...(date ? ["Preferred date: " + date] : []),
    ...(location ? ["Service location: " + location] : []),
    ...(budgetLabel ? ["Suggested budget (not a payment or fixed quote): " + budgetLabel] : []),
  ];
  const result = lines.join("\n\n");
  return result.length <= 2000 ? result : null;
}
