export const DEFAULT_MARKETPLACE_LOCATION = "Harare";
export const MARKETPLACE_LOCATION_COOKIE = "bidblitz_home_location";

export const MARKETPLACE_TOWNS = [
  ["Harare", -17.8292, 31.0522],
  ["Bulawayo", -20.154, 28.588],
  ["Chitungwiza", -18.0127, 31.0756],
  ["Gweru", -19.458, 29.815],
  ["Mutare", -18.972, 32.6709],
  ["Masvingo", -20.075, 30.832],
  ["Kwekwe", -18.928, 29.815],
  ["Kadoma", -18.334, 29.916],
  ["Marondera", -18.185, 31.551],
  ["Victoria Falls", -17.932, 25.826],
] as const;

export function normalizeMarketplaceLocation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const location = value.trim().replace(/ +/g, " ");
  if (location.length < 2 || location.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N} ,.'’()-]*$/u.test(location)) return null;
  return MARKETPLACE_TOWNS.find(([town]) => town.toLowerCase() === location.toLowerCase())?.[0] ?? location;
}

export function marketplaceLocation(value: unknown): string {
  return normalizeMarketplaceLocation(value) ?? DEFAULT_MARKETPLACE_LOCATION;
}

export function locationSearchPattern(location: string): string {
  return `%${location.replace(/[\\%_]/g, "\\$&")}%`;
}
