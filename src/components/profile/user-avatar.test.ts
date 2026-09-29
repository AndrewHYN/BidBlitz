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
    // would hide the very null the guard exists to make impossible. The src
    // goes through the optimiser builder, which is pinned in lib/avatar.test.ts.
    expect(src).toMatch(/src=\{optimizedAvatarSrc\(imageSrc, px\)\}/);
    expect(src).not.toMatch(/src=\{imageSrc\}/);
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

    /*
     * And the retries are SPACED. Measured on a fresh upload: the first
     * request answered 400 while the object was not yet visible to the
     * optimiser, and the same URL returned decodable bytes from t=5s onward.
     * Three retries inside 160ms all fail inside the same blind window and
     * then give up forever. A recordFailure that increments the counter
     * synchronously is that bug, so it is refused here.
     */
    expect(src).toMatch(/const RETRY_DELAYS_MS = \[/);
    expect(src).toMatch(/retryTimer\.current = setTimeout/);
    // A retry scheduled for a previous key must never fire for this one.
    expect(src).toMatch(/clearTimeout\(retryTimer\.current\)/);
    expect(src).toMatch(/\}, \[url\]\);/);
    // The counter advances only when the timer fires, never synchronously.
    expect(src).not.toMatch(/setFailures\(\(prev\) =>/);
    expect(src).toMatch(/v=\$\{failureCount\}/);

    /*
     * And different from every previous mount's, not just from attempt 0.
     *
     * A retry URL that an earlier upload/remove cycle already requested can
     * already hold a poisoned cache entry, and retrying it fails identically
     * forever. Measured: three attempts against previously-requested variant
     * URLs all failed while the same bytes decoded fine, because those entries
     * had been cached during earlier churn. A per-mount nonce makes each
     * mount's retries URLs nobody has ever asked for, so they go to a live
     * fetch instead.
     *
     * The nonce must be stable per mount (lazy state, not inline random, or
     * the src churns and reloads every render) and must never appear on
     * attempt 0 (the canonical URL is also what the server renders, so a
     * different client value would be a hydration mismatch).
     */
    expect(src).toMatch(/const \[mountNonce\] = useState\(\(\) => Math\.random\(\)/);
    expect(src).toMatch(/&m=\$\{mountNonce\}/);
  });

  it("catches a load that finished before React attached onLoad", () => {
    const src = code();
    /*
     * The missed-load race. A server-rendered <img> hydrating with a cache hit
     * completes during parse, before hydration attaches the listener, so
     * neither load nor error ever fires. Measured: a header avatar holding
     * decoded 1x1 pixels at state "initials" with no further network traffic.
     *
     * The ref callback checks completeness at mount, which is exactly the
     * window the race lives in. An effect would work too, but setting state
     * synchronously in an effect body is a cascading-render hazard; the ref
     * callback belongs to the element's attachment instead.
     *
     * Either the events or this check observes each attempt, never both, and
     * the settled gate keeps a re-attach from recording anything twice.
     */
    expect(src).toMatch(/ref=\{attachAndCatchUp\}/);
    expect(src).toMatch(/if \(!el \|\| !el\.complete \|\| imageSrc === null\) return;/);
    expect(src).toMatch(/if \(isLoaded \|\| isFailed\) return;/);
    // The check must route through the same two outcomes as the events: a
    // zero-size completion is a failure, anything else is loaded.
    expect(src).toMatch(/if \(el\.naturalWidth === 0\) recordFailure\(\);/);
    expect(src).toMatch(/else if \(url !== null\) setLoadedUrl\(url\);/);
  });

  it("routes both failure modes through the bound, so neither can loop forever", () => {
    const src = code();
    // `onError` for a failed fetch, and `onLoad` for an image that loads with
    // zero pixels. Both must go through the counter, or one of them bypasses the
    // bound.
    expect(src).toMatch(/onError=\{recordFailure\}/);
    // The definition, the zero-size call, and the onError handler: anything
    // fewer means a failure path was left un-routed.
    const uses = src.match(/recordFailure/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    // Exactly one place may advance the counter, and it is inside the timer.
    // Two would mean a synchronous path that bypasses the spacing.
    const advances = src.match(/count: current \+ 1/g) ?? [];
    expect(advances.length).toBe(1);
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

  it("renders a plain img fed by the optimiser builder, with no srcset machinery", () => {
    const src = code();
    /*
     * Bisected twice in production: an element carrying srcset+sizes reported
     * naturalWidth 0 for responses a bare element with the same URL decoded in
     * the same minute. The component therefore emits no srcset at all - and
     * `sizes` without a srcset is meaningless, so it goes too. What stays is
     * the optimisation itself: the builder asks for exactly one width, so a
     * 32px header never downloads the multi-megabyte original.
     */
    expect(src).not.toMatch(/from "next\/image"/);
    expect(src).not.toMatch(/<Image/);
    expect(src).toMatch(/<img/);
    expect(src).toMatch(/src=\{optimizedAvatarSrc\(imageSrc, px\)\}/);
    expect(src).not.toMatch(/sizes=/);
    expect(src).not.toMatch(/srcSet|srcset/i);
    // The rendered frame is still exactly the reserved size.
    expect(src).toMatch(/width=\{px\}/);
    expect(src).toMatch(/height=\{px\}/);
  });
});
