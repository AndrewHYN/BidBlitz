import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: the avatar renders the picture and the initials, but never both, and a
 * failure is never final.
 *
 * ## The first defect
 *
 * The avatar showed a real photograph with the fallback initials painted on top
 * of it, at the same time, in the same frame. The screenshot of it was the whole
 * reason this file exists.
 *
 * The cause was subtle and was invisible in review. `UserAvatar` used
 * `next/image` rather than Radix's `AvatarImage`, because a plain `<img src>`
 * made the header download the original multi-megabyte upload on every page for
 * every signed-in visitor. But Radix tracks image state through a context that
 * only `AvatarImage` updates. Nothing was ever telling it an image arrived, so
 * its `status` stayed `"loading"` for the life of the component — and
 * `AvatarFallback` renders whenever `status !== "loaded"`. The fallback was
 * therefore *always* in the tree, and since Radix's root is `relative flex` with
 * both children `size-full`, both were painted and stacked.
 *
 * ## The second defect, which is worse
 *
 * A failed load was remembered permanently. The storage key is deterministic —
 * `<userId>/avatar.<ext>` — so replacing a picture in the same format produces
 * the *same* `/_next/image` URL, which our own origin caches for a year. Once the
 * component recorded a failure for that URL it never asked again, and since a
 * replacement arrives at the same URL, re-uploading could not clear it.
 *
 * The measured symptom: the upload action returned `ok`, the toast said the
 * picture was updated, the row held the expected key, the object existed, and
 * the avatar stayed on its initials forever. An underlying object answering 404
 * while the optimiser served a cached PNG with `age=92502` (about 25.7 hours)
 * is the fingerprint.
 *
 * So a failure is now counted per URL and bounded, and each retry asks for a
 * different URL.
 *
 * ## Why a static rule and not only an e2e test
 *
 * The e2e suite asserts the rendered result, and that is the real proof. These
 * rules hold the *shape*, which is what matters and which can be checked without
 * a browser: if the component ever again renders two things that can both be
 * visible, or reaches for a status-driven component it does not drive, or
 * returns to a permanent failure, the defect returns even if the e2e test is
 * later loosened. TypeScript cannot express "these two must be mutually
 * exclusive", and ESLint has no rule for it — the same gap
 * `form-method.test.ts` was written to close.
 */

const SOURCE = join(process.cwd(), "src", "components", "profile", "user-avatar.tsx");

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

  it("keeps the two states visually exclusive, and still lets the image load", () => {
    const src = code();

    /*
     * This invariant has to be right in both directions, and both mistakes are
     * real ones that happened here.
     *
     * Too exclusive — rendering the image only after `loadedUrl` is set — is a
     * deadlock: an element that is not rendered cannot fire `onLoad`, so the
     * picture never arrives and the avatar is initials forever.
     *
     * Too loose — leaving the image and the initials both painted — is the
     * original defect.
     *
     * The correct shape: the image is rendered whenever there is a usable src so
     * it can load, and it is hidden until it has. The initials are rendered
     * exactly when the image is not the visible thing.
     */
    expect(src).toMatch(/const showInitials = !isLoaded;/);

    // Rendered from "there is a src", NOT from "has loaded". `imageSrc` is null
    // exactly when the key is unusable or the attempts are spent, so the
    // condition and the value cannot drift apart.
    expect(src).toMatch(/\{imageSrc !== null \? \(/);
    expect(src).not.toMatch(/\{renderImage \? \(/);
    expect(src).not.toMatch(/\{showImage \? \(/);

    // A src is a src, so TypeScript needs no assertion to narrow it. A cast here
    // would hide the very null the guard exists to make impossible.
    expect(src).toMatch(/src=\{imageSrc\}/);
    expect(src).not.toMatch(/url!\}/);
    expect(src).not.toMatch(/url as string/);

    // The initials are the complement of "the image is showing".
    expect(src).toMatch(/\{showInitials \? \(/);

    /*
     * Hidden with OPACITY, and never with `visibility: hidden`.
     *
     * A visibility-hidden image is not decoded by the browser, so `load` arrives
     * with `complete === true` and `naturalWidth === 0`. The zero-size guard -
     * which is genuinely needed for a corrupt object - then reads a perfectly
     * good image as broken, and the component removes it. Measured: three
     * `w=96` requests, all `200 image/png`, and a frame with no <img> at all
     * that stayed on its initials for 32 seconds.
     *
     * Opacity does not prevent decoding, and the initials are opaque and painted
     * above it, so exactly one thing is ever visible.
     */
    expect(src).toMatch(/isLoaded \? "opacity-100" : "opacity-0"/);
    expect(src).not.toMatch(/invisible/);
    // And the letters must be pinned above the transparent image, not left to
    // happen to come later in the document.
    expect(src).toMatch(/relative z-10 grid size-full/);
  });

  it("counts failures against the URL, so a retry is a different request", () => {
    const src = code();

    /*
     * The second defect. A permanent failure is wrong here for a specific
     * reason, not as a matter of taste: the key is deterministic, so the same
     * picture replacement reuses the same cached URL, and "never ask again"
     * therefore becomes "never show this user's picture again".
     */
    expect(src).not.toMatch(/failedUrl/);
    expect(src).not.toMatch(/setFailedUrl/);
    expect(src).toMatch(
      /const \[failures, setFailures\] = useState<\{ url: string; count: number \} \| null>\(null\)/
    );

    // Bounded, so a genuinely deleted object still settles on initials quickly.
    expect(src).toMatch(/const MAX_LOAD_ATTEMPTS = \d+;/);
    expect(src).toMatch(/failureCount >= MAX_LOAD_ATTEMPTS/);

    // Keyed on the URL, so a new picture starts from zero and the previous
    // picture's failures are forgotten rather than inherited.
    expect(src).toMatch(/failures && failures\.url === url \? failures\.count : 0/);

    // And the retry really is a different request, not the same one again.
    expect(src).toMatch(/v=\$\{failureCount\}/);
  });

  it("routes both failure modes through the bound, so neither can loop forever", () => {
    const src = code();
    // `onError` for a failed fetch, and `onLoad` for an image that loads with
    // zero pixels. Both must go through the counter, or one of them bypasses the
    // bound.
    expect(src).toMatch(/onError=\{recordFailure\}/);
    // Three references: the definition, the zero-size call, and the onError
    // handler. Anything fewer means a failure path was left un-routed.
    const uses = src.match(/recordFailure/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    // Nothing may increment the counter directly and skip the bound.
    expect(src).not.toMatch(/setFailures\(\{[^}]*count: \d+ \}\)/);
  });

  it("treats a zero-size loaded image as a failure, not a success", () => {
    const src = code();
    /*
     * `onError` does not fire for an undecodable image. The browser reports
     * `complete === true` with `naturalWidth === 0` and considers the fetch
     * successful, so a corrupt or truncated object produces an empty circle
     * with no fallback and no error. Measured in production against a stored
     * object the decoder rejected.
     */
    expect(src).toMatch(/naturalWidth === 0/);
    expect(src).toMatch(/naturalWidth === 0[\s\S]{0,200}recordFailure\(\)/);
    // And the ordinary success path must still mark it loaded.
    expect(src).toMatch(/setLoadedUrl\(url\)/);
  });

  it("exposes the rendered state so a test can assert it", () => {
    const src = code();
    // A screenshot can be argued about; an attribute cannot. The e2e suite
    // asserts this, and asserts that "both" is not a value it can ever emit.
    expect(src).toMatch(/data-avatar-state=\{isLoaded \? "image" : "initials"\}/);
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
