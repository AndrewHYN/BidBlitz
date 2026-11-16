/** Keep user-entered places intact, but never present generic placeholder words as real geography. */
const GENERIC_LOCATION = /^(town|city|suburb|location|n\/?a|unknown|unspecified)$/i;

export function publicListingLocation(input: string | null | undefined): string {
  const value = input?.trim() ?? "";
  return !value || GENERIC_LOCATION.test(value) ? "Location not specified" : value;
}
