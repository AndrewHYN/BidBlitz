export function normalizeZimbabwePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s()-]/g, "");
  let local = compact;

  if (local.startsWith("+263")) local = "0" + local.slice(4);
  else if (local.startsWith("263")) local = "0" + local.slice(3);

  if (!/^0[0-9]{9}$/.test(local)) return null;
  return `+263${local.slice(1)}`;
}

/** International dialable format (E.164 shape); not a carrier or ownership check. */
export function isInternationalContactPhone(value: string): boolean {
  return /^\+[1-9][0-9]{6,14}$/.test(value);
}

/** Preserve Zimbabwe local-number convenience. Foreign numbers must include a country code. */
export function normalizeListingContactPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s()-]/g, "");
  const international = compact.startsWith("00") ? "+" + compact.slice(2) : compact;
  if (international.startsWith("+")) {
    return isInternationalContactPhone(international) ? international : null;
  }
  return normalizeZimbabwePhone(international);
}
