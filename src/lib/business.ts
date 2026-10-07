export const BUSINESS_LOGO_BUCKET = "business-logos";
export const BUSINESS_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function businessLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!/^[0-9a-f-]{36}\/logo\.(jpg|jpeg|png|webp|gif)$/.test(path)) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${BUSINESS_LOGO_BUCKET}/${path}`;
}
