"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { avatarUrlFor, initialsFor, optimizedAvatarSrc } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * The one avatar used everywhere a person is shown.
 *
 * ## Why this exists instead of `AvatarImage`
 *
 * Radix's own `AvatarImage` is a plain `<img src>`, so the header avatar fetched
 * the *original* object from Supabase on every page for every signed-in visitor,
 * at whatever resolution it was uploaded. The image therefore goes through the
 * `/_next/image` optimiser — but as a plain `<img>` fed by `optimizedAvatarSrc`,
 * not through the `next/image` component. That component emits `srcset`+`sizes`,
 * and that machinery is what the latest defect turned on: bisected twice, an
 * element carrying it reported `naturalWidth` 0 for responses a bare element
 * with the same URL decoded in the same minute. The builder asks the optimiser
 * for exactly one width, so the download stays small and there is no selection
 * to misbehave.
 *
 * ## The bug this fixes
 *
 * Because this is not Radix's `AvatarImage`, Radix's internal `status` never
 * leaves `"loading"` — nothing ever tells it an image arrived. `AvatarFallback`
 * renders whenever `status !== "loaded"`, so it was ALWAYS rendered, beside our
 * image, inside a `relative flex` root. Both `size-full`, both `rounded-full`,
 * both painted: a photograph with the initials sitting on top of it.
 *
 * A single `showImage` boolean could not fix it, because the fallback's
 * visibility was never ours to control. The fix is to stop using the
 * status-dependent component at all and own the fallback here. Radix's `Root`
 * is kept — it is a styled box and a context provider, with no status logic of
 * its own — so the frame, the border and the stock sizes are unchanged.
 *
 * ## The states, and why they are keyed by URL
 *
 *   no valid key            -> initials, and no image element
 *   valid key, still loading -> initials visible, image present but hidden
 *   valid key, loaded       -> image visible, initials not rendered
 *   valid key, failed       -> initials, and the image element is removed
 *
 * Mutually exclusive **visually**, not structurally. The first attempt at this
 * fix made them exclusive structurally, rendering the image only once it had
 * loaded — which deadlocks, because `onLoad` cannot fire for an element that was
 * never rendered, so the picture never appeared and every avatar stayed on
 * initials. That was caught by looking at a rendered page, not by a test. See
 * the render for the full reasoning.
 *
 * `loaded` and `failed` are both remembered **against the URL they refer to**.
 * That is what makes replacing a picture work: when the key changes, neither
 * matches the new URL, so the component falls back to initials and retries
 * cleanly, instead of inheriting the old image's success or its failure. A
 * single `boolean broken` cannot tell "this picture failed" from "the previous
 * picture failed".
 *
 * ## No flash
 *
 * The swap is instantaneous, with no crossfade, on purpose. A crossfade would
 * mean the photo and the letters are both painted for its duration, which is
 * exactly what is being fixed. At 24-80px the instant swap is imperceptible,
 * and the frame reserves its space either way, so there is no layout shift.
 *
 * ## Accessibility
 *
 * The image is `alt=""` and the initials are `aria-hidden`, so the avatar
 * contributes nothing to the accessibility tree. That is right for every call
 * site, because each pairs the avatar with the person's name: the profile `h1`,
 * the seller name beside the card, the account email in Settings, and the
 * header button's own `aria-label`. Without that pairing, exposing the avatar
 * would only repeat the letters immediately after the name was announced.
 */
export function UserAvatar({
  avatarPath,
  name,
  size = "default",
  className,
  pixelSize,
}: {
  /** The `profiles.avatar_path` storage key, or null. */
  avatarPath: string | null | undefined;
  /** Used only for the fallback initials. Never rendered as image alt text. */
  name: string | null | undefined;
  size?: "sm" | "default" | "lg";
  className?: string;
  /**
   * The rendered width in CSS pixels, when the surface is not a stock size.
   * Drives both the fixed frame and the `sizes` hint, which is what tells the
   * optimizer which variant to build. A wrong value here is a wrong-size
   * image, so pass the real number rather than guessing.
   */
  pixelSize?: number;
}) {
  // The ONLY place a storage key becomes a URL. A key that is not one of ours,
  // or that is not a key at all, is refused here rather than rendered.
  const url = avatarUrlFor(avatarPath);

  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  // Failures are COUNTED against the URL they describe, not remembered as a
  // single "broken" flag. See "Why a failure is retried" below: the difference
  // between those two is the whole bug.
  const [failures, setFailures] = useState<{ url: string; count: number } | null>(null);

  /*
   * Why a failure is retried, rather than remembered.
   *
   * The storage key is deterministic: `<userId>/avatar.<ext>`. So replacing a
   * picture with the same format produces the SAME `/_next/image` URL, and our
   * own origin caches that entry for up to a year. A previous version remembered
   * a single remembered-failure flag and, once an image failed, refused to render it for the
   * life of the component, with no way back.
   *
   * Combined with that cache, it is a permanent and self-inflicted failure:
   *
   *   1. The optimiser is asked before the new object is visible, or a CDN edge
   *      answers from a stale or failing entry. The image errors.
   *   2. The component records the failure and never asks again.
   *   3. The user re-uploads a correct picture in the same format. It lands at
   *      the same key, therefore the same URL, and is still refused.
   *
   * The result is an avatar stuck on its initials while the upload reports
   * success and the object is genuinely there. Measured in production: the
   * underlying object answered 404 while `/_next/image?w=96` served a cached PNG
   * with `age=92502`, about 25.7 hours, and the component would not retry.
   *
   * So a failure is bounded, not final. Each retry asks for a DIFFERENT URL, by
   * adding a version parameter, so a stale cache entry cannot be handed back
   * again and the optimiser genuinely re-fetches.
   *
   * And the retries are SPACED, not immediate. Measured on a fresh upload:
   * the component's own first request answered 400 while the object was not
   * yet visible to the optimiser, and the same URL returned decodable bytes
   * from t=5s onward for the next 70 seconds. Three retries inside 160ms all
   * fail inside the same blind window and then give up forever, which is
   * exactly what happened. Attempts at roughly t=0s, t=2s and t=10s land
   * outside any plausible window while keeping the happy path instant and a
   * genuinely deleted object settling on initials within seconds.
   */
  const MAX_LOAD_ATTEMPTS = 3;
  const failureCount = failures && failures.url === url ? failures.count : 0;
  const isFailed = url !== null && failureCount >= MAX_LOAD_ATTEMPTS;
  const isLoaded = url !== null && loadedUrl === url;

  // A retry scheduled for a previous key must never fire for this one, and a
  // timer must never outlive the component. Read inside the cleanup, not
  // outside it: the value has to be the one held when the cleanup runs.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    return () => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [url]);

  // Attempt-indexed delays: the first retry waits out a short propagation
  // gap, the second waits out a long one. Indexed, not constant, so lengthening
  // the window means changing a number here rather than restructuring.
  //
  // The numbers have margin on purpose. One clean measurement put the blind
  // window under 5s, but a later failure 12s after a write counsels against
  // trusting that. Margin costs nothing visible: the user sees initials
  // throughout, so a recovery at 15s looks exactly like a recovery at 2s.
  const RETRY_DELAYS_MS = [3000, 12000];

  const recordFailure = () => {
    if (url === null || retryTimer.current) return;
    const current = failures && failures.url === url ? failures.count : 0;
    if (current + 1 >= MAX_LOAD_ATTEMPTS) {
      // Attempts spent. Settle on initials and remove the image element.
      // Immediate, because there is nothing left to wait for.
      setFailures({ url, count: MAX_LOAD_ATTEMPTS });
      return;
    }
    // Not yet: schedule the next attempt after its delay. While it waits, the
    // failed src stays rendered but inert - the browser does not re-request a
    // src that already failed - so the visible state does not flicker.
    const delay = RETRY_DELAYS_MS[current] ?? 8000;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setFailures({ url, count: current + 1 });
    }, delay);
  };

  // The URL actually requested, or null when there is nothing to show.
  //
  // Null is the guard. An image element is rendered only when there is a src,
  // so a missing key, or one that has exhausted its attempts, cannot produce a
  // broken <img> at all: the condition and the value are the same thing.
  //
  // `next/image` hashes the query string, so parameters reach the optimiser
  // rather than being folded away. That is the point twice over:
  //
  // - `v` makes each attempt a different request, so a stale entry for one
  //   attempt cannot be handed back for the next.
  // - `m` makes each MOUNT's attempts different from every previous mount's.
  //   A retry URL that an earlier upload/remove cycle already poisoned would
  //   fail identically forever; a URL nobody has ever asked for goes to a live
  //   fetch instead. Measured: three attempts against previously-requested
  //   variant URLs all failed while the same bytes decoded fine, because every
  //   one of those entries had been cached during earlier churn.
  //
  // Attempt 0 deliberately carries neither: it is the canonical, cacheable URL,
  // and it is also what the server renders, so keeping it parameter-free means
  // hydration never sees a different src on the client. The nonce only ever
  // appears on retries, which by construction happen after hydration.
  // Stable for the life of this mount. A lazy state initializer runs once,
  // which is exactly the semantics needed: the same value on every render, a new
  // one on every mount. Random per mount is fine because it never reaches the
  // server render (see above). NOT useRef-during-render and NOT Math.random()
  // inline, both of which the linter rightly refuses: the first reads a ref
  // during render, the second would churn the src and reload on every render.
  const [mountNonce] = useState(() => Math.random().toString(36).slice(2, 8));
  const imageSrc =
    url === null || isFailed
      ? null
      : failureCount > 0
        ? `${url}${url.includes("?") ? "&" : "?"}v=${failureCount}&m=${mountNonce}`
        : url;

  /*
   * A cached image can finish loading before React attaches onLoad.
   *
   * Measured: a header avatar with naturalWidth 1, opacity 0, state
   * 'initials', and no further network traffic - a decoded image whose
   * `load` event never arrived. A server-rendered <img> hydrating with a
   * cache hit completes during parse, before hydration attaches the
   * listener, so neither `load` nor `error` ever fires and the avatar sits
   * on its initials holding decoded pixels. This is the documented React
   * missed-load race, not a theory: instant cache hits reproduce it, slow
   * fetches do not, which is also why the header failed on fresh navigations
   * while client-side mounts kept working.
   *
   * So the ref callback checks completeness at mount, which is exactly the
   * window the race lives in: after mount the listeners are attached and the
   * events arrive normally. Either the events or this check observes each
   * attempt, never both, because `complete` is monotonic per src. The gate on
   * `!isLoaded && !isFailed` keeps a re-attach from recording anything twice:
   * once an attempt is settled there is nothing left to observe.
   *
   * A ref callback rather than an effect, deliberately: the check belongs to
   * the element's attachment, not to a render pass, and setting state
   * synchronously inside an effect body is a cascading-render hazard the
   * linter rightly refuses.
   */
  const attachAndCatchUp = (el: HTMLImageElement | null) => {
    imgRef.current = el;
    if (!el || !el.complete || imageSrc === null) return;
    if (isLoaded || isFailed) return;
    if (el.naturalWidth === 0) recordFailure();
    else if (url !== null) setLoadedUrl(url);
  };

  /*
   * The image has to be IN THE DOM before it can load.
   *
   * The obvious way to guarantee "never both" is to render the image only once
   * it has loaded — and that deadlocks: `onLoad` cannot fire for an element that
   * was never rendered, so the picture never appears and the avatar is
   * permanently initials. That is not a theoretical mistake; it is exactly what
   * the first version of this fix did, and it was caught by looking at the
   * rendered page rather than by a test.
   *
   * So the two are mutually exclusive *visually*, not structurally:
   *
   *   url is null              -> initials, no image element
   *   url valid, loading       -> initials visible, image rendered but hidden
   *   url valid, loaded        -> image visible, initials NOT rendered
   *   url valid, failed        -> initials, image element removed
   *
   * While loading, the image is `invisible`, not merely transparent. That keeps
   * it out of the accessibility tree and out of Playwright's visibility check,
   * so "both are on screen" is not something the DOM can express or a test can
   * accidentally pass.
   */
  const showInitials = !isLoaded;
  const initials = initialsFor(name);

  const stock: Record<string, number> = { sm: 24, default: 32, lg: 40 };
  const px = pixelSize ?? stock[size] ?? 32;
  // The stock sizes have hard-coded Tailwind classes; a custom pixel size gets
  // an inline frame so the image is exactly as big as the space reserved.
  const frame = pixelSize === undefined ? undefined : { width: px, height: px };

  return (
    <Avatar
      size={size}
      className={cn(className)}
      style={frame}
      data-testid="user-avatar"
      // Asserted by the e2e suite: this is the state, not a class that merely
      // happens to look right. "both" must be unrepresentable.
      data-avatar-state={isLoaded ? "image" : "initials"}
    >
      {imageSrc !== null ? (
        // A plain <img>, not next/image, fed by the optimiser-URL builder.
        // next/image emits srcset+sizes, and that machinery is what failed:
        // bisected twice, an element carrying it reported naturalWidth 0 for
        // responses a bare element with the same URL decoded in the same
        // minute. The builder keeps the optimisation (a sized variant, never
        // the multi-megabyte original) with nothing left to mis-pick.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={optimizedAvatarSrc(imageSrc, px)}
          alt=""
          width={px}
          height={px}
          decoding="async"
          className={cn(
            "size-full rounded-full object-cover",
            // Hidden with OPACITY while loading. A controlled matrix showed
            // opacity does not prevent decoding, and the opaque initials sit on
            // top, so only one thing is ever painted.
            isLoaded ? "opacity-100" : "opacity-0"
          )}
          ref={attachAndCatchUp}
          data-testid="user-avatar-image"
          onLoad={(event) => {
            /*
             * A load event is not proof of an image.
             *
             * A stored object can be present, served 200, and carry bytes the
             * browser cannot decode — a truncated upload, a corrupt object. The
             * browser then reports `complete === true` with
             * `naturalWidth === 0` and **never fires `error`**, because from its
             * point of view the fetch succeeded. Without this check the avatar
             * sits there as an empty circle forever: the fallback never engages,
             * and the user has no way to tell a broken picture from a face.
             *
             * Zero intrinsic size is never a real avatar, so treat it as the
             * failure it is.
             */
            const img = event.currentTarget;
            if (img.naturalWidth === 0) {
              recordFailure();
              return;
            }
            setLoadedUrl(url);
          }}
          onError={recordFailure}
        />
      ) : null}

      {showInitials ? (
        <span
          aria-hidden="true"
          data-testid="user-avatar-initials"
          className={cn(
            "relative z-10 grid size-full place-items-center rounded-full bg-muted",
            "text-muted-foreground",
            size === "sm" ? "text-xs" : pixelSize && pixelSize > 40 ? "text-lg" : "text-sm"
          )}
        >
          {initials}
        </span>
      ) : null}
    </Avatar>
  );
}
