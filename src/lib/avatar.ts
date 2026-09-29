/**
 * Avatars — one place that knows the rules.
 *
 * Every avatar is a storage KEY, never a URL, in exactly one shape:
 *
 *     <owner auth uid>/avatar.<ext>       ext ∈ jpg | jpeg | png | webp | gif
 *
 * Three properties follow from that shape and are relied on everywhere:
 *
 *  1. The user id is derived from the SESSION on the server, never from
 *     anything the browser sends, so nobody can address another user's folder.
 *  2. The key is checked against the same regular expression the database's
 *     CHECK constraint enforces, so application and database agree and a value
 *     can never be rendered as something other than a key in this bucket.
 *  3. There is no remote image source at all. An avatar is either a key we
 *     uploaded, or a generated initials fallback.
 *
 * File type is decided by MAGIC BYTES, not by the browser's MIME type and not
 * by the filename. Both of those are chosen by whoever picked the file.
 */

export const AVATAR_BUCKET = "avatars";
/** Matches the database CHECK constraint and the storage policies exactly. */
export const AVATAR_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/avatar\.(jpg|jpeg|png|webp|gif)$/;
/** 2 MB, and the same number the bucket is configured with. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export type AvatarExt = "jpg" | "jpeg" | "png" | "webp" | "gif";

/** The single legal key for a user. Always derived from the session uid. */
export function avatarKeyFor(userId: string, ext: AvatarExt): string {
  return `${userId}/avatar.${ext}`;
}

/**
 * Is this a key we are willing to render? Anything else - a URL, a traversal
 * segment, another bucket's key - returns `null` and the caller shows initials.
 * Defence in depth: the database should never have let such a value exist.
 */
export function safeAvatarKey(path: string | null | undefined): string | null {
  return path && AVATAR_PATH_RE.test(path) ? path : null;
}

/** Absolute public URL for a key, or `null` when the key is not one of ours. */
export function avatarUrlFor(path: string | null | undefined): string | null {
  const key = safeAvatarKey(path);
  if (!key) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${AVATAR_BUCKET}/${key}`;
}

/**
 * The widths our image optimiser accepts. This mirrors the framework defaults,
 * and it is written out rather than imported because the whole point is a
 * contract the component can rely on: any width produced here must be served,
 * never refused with an invalid-request error.
 */
export const AVATAR_OPTIMIZER_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384];

/**
 * An optimiser URL for a storage URL, at a rendered size — without a srcset.
 *
 * The element this feeds is a plain `<img>`, deliberately, not `next/image`.
 * Bisected twice in production: an `<img>` carrying the responsive-images
 * machinery (`srcset` + `sizes`) reported `naturalWidth === 0` for responses
 * that a bare `<img>` with the same URL decoded as 1x1 in the same minute.
 * Same bytes, same browser, same page. The responsive selection is the only
 * structural difference, and the failure followed it exactly: present 0x0,
 * absent 1x1. The browser-internal mechanism was not identified, so rather
 * than depend on it the component does not emit it.
 *
 * What is kept: the optimiser itself. A plain `<img src={storageUrl}>` would
 * download the original multi-megabyte upload for a 32px header avatar, which
 * is the performance defect this component was built to prevent. This builder
 * asks the optimiser for exactly one width, so the download stays small and
 * there is nothing for a selection algorithm to mis-pick.
 *
 * Width is retina-aware and deterministic: the smallest accepted width at or
 * above twice the rendered size, so DPR-2 screens get real pixels rather than
 * an upscale, and server and client always compute the same string (a value
 * that differed between them would be a hydration mismatch). 32px renders ask
 * for 64, 80px renders ask for 256.
 */
export function optimizedAvatarSrc(storageUrl: string, px: number): string {
  const target = Math.max(1, px) * 2;
  const w =
    AVATAR_OPTIMIZER_WIDTHS.find((candidate) => candidate >= target) ??
    AVATAR_OPTIMIZER_WIDTHS[AVATAR_OPTIMIZER_WIDTHS.length - 1];
  return `/_next/image?url=${encodeURIComponent(storageUrl)}&w=${w}&q=75`;
}

/**
 * Identify an image from its leading bytes.
 *
 * Returns `null` for anything unrecognised, which is the rejection path: a
 * caller must treat "I could not identify this" as "this is not a supported
 * image", never as "assume JPEG". SVG is intentionally absent — it is an XML
 * document that can carry script, and serving one from our own origin would be
 * a stored-XSS vector.
 */
export function sniffImageExt(bytes: Uint8Array): AvatarExt | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && startsWith(0xff, 0xd8, 0xff)) return "jpg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  ) {
    return "png";
  }
  // GIF: "GIF87a" / "GIF89a"
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.subarray(0, 6));
    if (head === "GIF87a" || head === "GIF89a") return "gif";
  }
  // WebP: "RIFF" ....size.... "WEBP"  (bytes 0-3 and 8-11)
  if (
    bytes.length >= 12 &&
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

export type AvatarValidation =
  | { ok: true; ext: AvatarExt }
  | { ok: false; reason: string };

/**
 * Validate an upload from its bytes alone.
 *
 * Order matters for the message a user actually sees: tell them it is too big
 * before telling them it is the wrong type, because a 40 MB screenshot is
 * almost always simply too big and that is the fixable thing.
 */
export function validateAvatarBytes(bytes: Uint8Array): AvatarValidation {
  if (bytes.length === 0) {
    return { ok: false, reason: "That file is empty. Choose an image and try again." };
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      reason: `That image is ${formatBytes(bytes.length)}. The limit is 2 MB, so try a smaller picture.`,
    };
  }
  const ext = sniffImageExt(bytes);
  if (!ext) {
    return {
      ok: false,
      reason: "That file isn't a JPEG, PNG, WebP or GIF image.",
    };
  }
  return { ok: true, ext };
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Deterministic initials for the fallback.
 *
 * Deterministic matters: the same person must get the same two letters in
 * every surface, and it must never be empty (an empty circle reads as a broken
 * image) or longer than two characters (which overflows a small avatar).
 */
export function initialsFor(name: string | null | undefined): string {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const only = parts[0];
    // "hyndrrx0" -> "HY"; "H" -> "H"
    return only.slice(0, parts[0].length >= 2 ? 2 : 1).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
