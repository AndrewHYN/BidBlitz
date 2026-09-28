import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: the avatar renders the image and the initials, but never both.
 *
 * ## The defect
 *
 * The avatar showed a real photograph with the fallback initials painted on top
 * of it, at the same time, in the same frame. The screenshot of it was the whole
 * reason this file exists.
 *
 * The cause is subtle and was invisible in review. `UserAvatar` used
 * `next/image` rather than Radix's `AvatarImage`, because a plain `<img src>`
 * made the header download the original multi-megabyte upload on every page for
 * every signed-in visitor. But Radix tracks image state through a context that
 * only `AvatarImage` updates. Nothing was ever telling it an image arrived, so
 * its `status` stayed `"loading"` for the life of the component — and
 * `AvatarFallback` renders whenever `status !== "loaded"`. The fallback was
 * therefore *always* in the tree, and since Radix's root is `relative flex` with
 * both children `size-full`, both were painted and stacked.
 *
 * `showImage ? <Image/> : null` never guarded anything, because the fallback was
 * not behind that condition.
 *
 * ## Why a static rule and not only an e2e test
 *
 * The e2e suite asserts the rendered result, and that is the real proof — see
 * `e2e/avatar.spec.ts`, which uploads a picture, blocks the image request to
 * force a failure, and asserts exactly one of the two is in the DOM.
 *
 * This rule exists because the *shape* of the bug is what matters and it can be
 * checked without a browser: if the component ever again renders two children
 * that can both be visible, or reaches for a status-driven component it does not
 * drive, the defect returns even if the e2e test is later loosened. TypeScript
 * cannot express "these two must be mutually exclusive", and ESLint has no rule
 * for it — the same gap `form-method.test.ts` was written to close.
 */

const SOURCE = join(
  process.cwd(),
  "src",
  "components",
  "profile",
  "user-avatar.tsx"
);

/** The source with comments removed, so prose about the bug cannot match. */
function code(): string {
  return readFileSync(SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("UserAvatar rendering states", () => {
  it("does not use a status-driven Radix fallback it never drives", () => {
    const src = code();

    // `AvatarFallback` is safe only in the same tree that renders Radix's
    // `AvatarImage`, because that is the only thing that moves Radix's status
    // off "loading". `UserAvatar` deliberately does not, so the fallback must
    // not be used. If this fails, reintroducing it needs a real reason.
    expect(src).not.toMatch(/AvatarFallback/);
    // Nor `AvatarImage`, which would undo the `next/image` optimisation that
    // exists to stop the header downloading the original upload.
    expect(src).not.toMatch(/AvatarImage/);
  });

  it("renders the image and the initials in exclusive branches", () => {
    const src = code();

    // The image is a direct child of the root, guarded by the state.
    expect(src).toMatch(/\{showImage\s*\?\s*\(/);
    // ...and the initials occupy the other side of that same conditional.
    expect(src).toMatch(/\)\s*:\s*\(\s*<span/);

    // Belt and braces on the state itself: it must be impossible for both to be
    // true, so it is built from a loaded marker AND a failed marker rather than
    // from a single "broken" flag.
    expect(src).toMatch(/loadedUrl === url/);
    expect(src).toMatch(/failedUrl !== url/);
  });

  it("drives every visual state from a URL-keyed marker, so replacing a picture retries", () => {
    const src = code();

    // A single `boolean broken` cannot distinguish "this picture failed" from
    // "the previous picture failed", and a stale success cannot distinguish the
    // old picture from the new one. Both markers are therefore remembered
    // against the URL they describe.
    expect(src).toMatch(/useState<string \| null>\(null\)/);
    const markers = src.match(/useState<string \| null>\(null\)/g) ?? [];
    expect(markers.length).toBeGreaterThanOrEqual(2);

    // Both transitions must record the URL that produced them.
    expect(src).toMatch(/onLoad=\{\(\)\s*=>\s*setLoadedUrl\(url\)\}/);
    expect(src).toMatch(/onError=\{\(\)\s*=>\s*setFailedUrl\(url\)\}/);
  });

  it("exposes the rendered state so a test can assert it", () => {
    const src = code();
    // A screenshot can be argued about; an attribute cannot. The e2e suite
    // asserts this, and asserts that "both" is not a value it can ever emit.
    expect(src).toMatch(/data-avatar-state=\{showImage \? "image" : "initials"\}/);
    // "both" is deliberately absent from that expression.
    expect(src).not.toMatch(/data-avatar-state=\{[^}]*both/);
  });

  it("keeps the image decorative, and the initials hidden from assistive tech", () => {
    const src = code();
    // Every call site pairs the avatar with the person's visible name, so the
    // image must not repeat it, and the letters must not be announced either.
    expect(src).toMatch(/alt=""/);
    expect(src).toMatch(/aria-hidden="true"/);
  });

  it("keeps the next/image sizing hint, so the header still gets a 32px variant", () => {
    const src = code();
    // This is the reason the component does not use `AvatarImage` at all. If the
    // width/height/sizes triple is dropped, the optimiser is told nothing and
    // serves a variant sized for the largest rendering.
    expect(src).toMatch(/width=\{px\}/);
    expect(src).toMatch(/height=\{px\}/);
    expect(src).toMatch(/sizes=\{`\$\{px\}px`\}/);
  });
});
