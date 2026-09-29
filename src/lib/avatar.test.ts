import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_MAX_BYTES,
  AVATAR_OPTIMIZER_WIDTHS,
  AVATAR_PATH_RE,
  avatarKeyFor,
  avatarUrlFor,
  initialsFor,
  optimizedAvatarSrc,
  safeAvatarKey,
  sniffImageExt,
  validateAvatarBytes,
} from "@/lib/avatar";

/**
 * Avatar safety, in three layers that must agree.
 *
 * The old `profiles.avatar_url` column was free text and the UI rendered it
 * straight into an image source, so any user could point the site at a remote
 * image of their choosing. The replacement is a storage KEY with one legal
 * shape, and these tests pin that shape on both sides: the layer that decides
 * what to render, and the layer that decides whether bytes are an image at all.
 */

const UID = "6a492b28-bb5b-43b1-8f6d-f1cdd8856c58";
const OTHER_UID = "8aa833d5-c8a5-4d44-a219-1ad3f95958ad";

const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const gifBytes = Uint8Array.from([...Buffer.from("GIF89a", "ascii"), 0x01, 0x00]);
const webpBytes = Uint8Array.from([
  ...Buffer.from("RIFF", "ascii"), 0x1a, 0x00, 0x00, 0x00, ...Buffer.from("WEBP", "ascii"),
  0x56, 0x50, 0x38, 0x20,
]);

describe("safeAvatarKey()", () => {
  it("accepts the one legal shape", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
      const key = avatarKeyFor(UID, ext as "jpg");
      expect(AVATAR_PATH_RE.test(key)).toBe(true);
      expect(safeAvatarKey(key)).toBe(key);
    }
  });

  it("refuses anything that is not a key in our bucket", () => {
    const hostile = [
      // the whole point of removing the free-text column
      "https://attacker.tld/pixel.png",
      "//attacker.tld/pixel.png",
      "http://attacker.tld/pixel.png",
      "data:image/png;base64,iVBORw0KGgo=",
      // path traversal into another namespace
      `${OTHER_UID}/../${UID}/avatar.png`,
      "../etc/passwd",
      // traversal and separators that have no business in a key
      `${UID}\\avatar.png`,
      `/absolute/${UID}/avatar.png`,
      "./relative.png",
      // another bucket entirely
      "auction-images/whatever.png",
      // wrong file name inside a real folder
      `${UID}/../../secrets.txt`,
      `${UID}/evil.php`,
      // another user's key is still a valid SHAPE, so this is a policy
      // question, not a shape one - see the database check in verify-engine
      "",
    ];
    for (const value of hostile) {
      expect(safeAvatarKey(value), `should refuse ${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("refuses null and undefined", () => {
    expect(safeAvatarKey(null)).toBeNull();
    expect(safeAvatarKey(undefined)).toBeNull();
  });
});

describe("avatarUrlFor()", () => {
  // The builder needs the project's own Supabase origin, and the test runner
  // deliberately does not load .env.local. Stubbed here so the test states its
  // own precondition rather than inheriting whatever the shell happens to have.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project-test.supabase.co");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a URL in our own bucket from a valid key", () => {
    const url = avatarUrlFor(`${UID}/avatar.png`);
    expect(url).not.toBeNull();
    expect(url).toBe(
      `https://project-test.supabase.co/storage/v1/object/public/avatars/${UID}/avatar.png`
    );
  });

  it("returns null rather than passing a hostile value through to an <img>", () => {
    expect(avatarUrlFor("https://attacker.tld/pixel.png")).toBeNull();
    expect(avatarUrlFor("../../etc/passwd")).toBeNull();
    expect(avatarUrlFor(null)).toBeNull();
  });
});

describe("sniffImageExt()", () => {
  it("identifies the four supported raster formats from their bytes", () => {
    expect(sniffImageExt(pngBytes)).toBe("png");
    expect(sniffImageExt(jpegBytes)).toBe("jpg");
    expect(sniffImageExt(gifBytes)).toBe("gif");
    expect(sniffImageExt(webpBytes)).toBe("webp");
  });

  it("rejects SVG even though it is a perfectly good image file", () => {
    // SVG is an XML document that can carry script. Serving one from our own
    // origin is a stored-XSS vector, so it is not in the allow-list at all.
    const svg = Uint8Array.from(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', "utf8")
    );
    expect(sniffImageExt(svg)).toBeNull();
    expect(validateAvatarBytes(svg)).toMatchObject({ ok: false });
  });

  it("rejects things that merely claim to be images", () => {
    const notImages: Uint8Array[] = [
      new Uint8Array(0),
      Uint8Array.from(Buffer.from("not an image at all", "ascii")),
      Uint8Array.from(Buffer.from("%PDF-1.7\n...", "ascii")),
      Uint8Array.from(Buffer.from('{"a":1}', "ascii")),
      // a truncated PNG signature is not a PNG
      Uint8Array.from([0x89, 0x50, 0x4e]),
      // RIFF that is not WEBP (a .wav, say)
      Uint8Array.from([...Buffer.from("RIFF", "ascii"), 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]),
    ];
    for (const bytes of notImages) {
      expect(sniffImageExt(bytes), bytes.slice(0, 8).toString()).toBeNull();
    }
  });
});

describe("validateAvatarBytes()", () => {
  it("accepts a real image within the limit", () => {
    expect(validateAvatarBytes(pngBytes)).toEqual({ ok: true, ext: "png" });
  });

  it("rejects an oversized file, and says so before anything else", () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set(pngBytes);
    const result = validateAvatarBytes(big);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The size is the thing the user can fix, so it must be the first reason.
    expect(result.reason).toMatch(/2 MB/);
  });

  it("rejects an empty file with copy that names the fix", () => {
    const result = validateAvatarBytes(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/empty/i);
  });

  it("rejects a file whose bytes are not a supported image", () => {
    const result = validateAvatarBytes(
      Uint8Array.from(Buffer.from("MZ\u0090\u0000 this is an exe", "binary"))
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/JPEG, PNG, WebP or GIF/);
  });
});

describe("initialsFor()", () => {
  it("is deterministic and never empty", () => {
    // The fallback is what a user sees on every surface. It must never render
    // as a blank circle, and the same person must look the same everywhere.
    expect(initialsFor("Hyndrrx")).toBe("HY");
    expect(initialsFor("Hyndrrx")).toBe(initialsFor("Hyndrrx"));
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
    expect(initialsFor(null)).toBe("?");
    expect(initialsFor(undefined)).toBe("?");
  });

  it("uses at most two characters, from the first and last word", () => {
    expect(initialsFor("Ana Beatriz Souza")).toBe("AS");
    expect(initialsFor("Ada")).toBe("AD");
    // A one-character name must still show something rather than nothing.
    expect(initialsFor("X")).toBe("X");
  });
});

describe("optimizedAvatarSrc()", () => {
  const STORAGE =
    "https://zteakuiuvcikwpnkgxsn.supabase.co/storage/v1/object/public/avatars/39ecaf2c-6f7b-4eeb-8782-99ed5f4e13fc/avatar.png";

  it("asks the optimiser for exactly one width, with no srcset machinery", () => {
    // The component renders a plain <img> with this string as its src. There
    // is no srcset and no sizes anywhere in it: a single request, a single
    // cache entry, nothing for a selection algorithm to mis-pick.
    const src = optimizedAvatarSrc(STORAGE, 80);
    expect(src.startsWith("/_next/image?url=")).toBe(true);
    expect(src).not.toContain("srcset");
    expect(src).not.toContain("sizes=");
  });

  it("maps a rendered size to the smallest accepted width at double density", () => {
    // Retina-aware and deterministic: server and client must compute the same
    // string, or hydration mismatches on the src. 32px renders ask for 64 and
    // 80px renders ask for 256 - small downloads either way, and never the
    // multi-megabyte original.
    expect(optimizedAvatarSrc(STORAGE, 32)).toContain("w=64");
    expect(optimizedAvatarSrc(STORAGE, 80)).toContain("w=256");
    for (const px of [24, 32, 40, 64, 80, 96]) {
      const w = Number(optimizedAvatarSrc(STORAGE, px).match(/w=(\d+)/)?.[1]);
      expect(AVATAR_OPTIMIZER_WIDTHS).toContain(w);
      expect(w).toBeGreaterThanOrEqual(px);
    }
  });

  it("keeps the storage URL, including retry parameters, inside the url value", () => {
    // Retry parameters (?v=, &m=) belong to the nested storage URL, so each
    // retry is a genuinely different optimiser entry. If they leaked to the
    // outer query string instead, the optimiser would ignore them and every
    // retry would return the same cached entry.
    const retrying = `${STORAGE}?v=2&m=abc123`;
    const src = optimizedAvatarSrc(retrying, 80);
    const nested = new URL(src, "https://bidblitz.test").searchParams.get("url");
    expect(nested).toBe(retrying);
  });

  it("keeps the quality setting the product standardised on", () => {
    expect(optimizedAvatarSrc(STORAGE, 80)).toContain("q=75");
  });
});
