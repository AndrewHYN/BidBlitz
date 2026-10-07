export function normalizeZimbabwePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s()-]/g, "");
  let local = compact;

  if (local.startsWith("+263")) local = "0" + local.slice(4);
  else if (local.startsWith("263")) local = "0" + local.slice(3);

  if (!/^0[0-9]{9}$/.test(local)) return null;
  return `+263${local.slice(1)}`;
}
