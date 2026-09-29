# Profile pictures

Everything here was found by looking at rendered pages. Every one of the defects
below passed typecheck, passed lint, and passed 263 unit tests and 136 database
checks while it was live in production.

## The original defect: two states, one frame

A real photograph and the fallback initials rendered at the same time, stacked in
the same avatar frame.

The cause was not the `showImage` boolean, which guarded nothing. `UserAvatar`
used `next/image` rather than Radix's `AvatarImage`, deliberately, because a plain
`<img src>` made the header download the original multi-megabyte upload on every
page for every signed-in visitor. But Radix tracks image state through a context
that only `AvatarImage` updates. Nothing was ever telling it an image arrived, so
its `status` stayed `"loading"` for the life of the component, and
`AvatarFallback` renders whenever `status !== "loaded"`.

The fallback was therefore in the tree unconditionally, inside a `relative flex`
root, with both children `size-full` and `rounded-full`. Both painted.

The fix is to stop using the status-driven component and own the fallback.

## The three states, and why they are keyed by URL

| State | What renders |
| --- | --- |
| No valid key | Initials. No image element. |
| Valid key, loading | Initials visible, image present but hidden |
| Valid key, loaded | Image visible, initials not rendered |
| Valid key, failed | Initials. The image element is removed |

Mutually exclusive **visually**, not structurally. The first attempt at this fix
made them exclusive structurally, rendering the image only once it had loaded,
and that deadlocks: `onLoad` cannot fire for an element that was never rendered,
so the picture never arrived and every avatar sat on its initials forever. That
was caught by looking at a rendered page, not by a test.

`loaded` and `failed` are both remembered **against the URL they describe**.
That is what makes replacing a picture work: when the key changes, neither
matches, so the component falls back to initials and retries rather than
inheriting the previous picture's success or its failure.

Hidden means `invisible`, not `opacity-0`, because opacity alone leaves the node
in the accessibility tree and passes any naive visibility check.

## A loaded image with no pixels is a broken image

`onError` does not fire for an image the browser cannot decode. The fetch
succeeded, so the browser reports `complete === true` with `naturalWidth === 0`
and considers its job done. Without the zero-size check the avatar sat as an
empty circle with no fallback and no error.

Zero intrinsic size is never a real avatar, so `onLoad` rejects it and the
letters take over.

## The optimistic blob was revoked while still on screen

The cleanup effect that released the object URL depended on the `preview`
**object**, whose identity is replaced when `replaces` is filled in after a
successful upload. React therefore ran the cleanup at exactly the wrong moment
and released the blob URL that was still rendered:
`net::ERR_FILE_NOT_FOUND`, and a broken image in the one place a user goes to
confirm their picture uploaded.

The dependency is now the URL string, so a revoke happens only when the rendered
URL genuinely changes.

## A profile change did not refresh the surface the user was looking at

Three bugs of one shape: the write was correct, the action returned `ok`, and
something the user could see still showed the old value.

1. **The Settings preview never showed the picture you just uploaded.**
   `uploadAvatarAction` revalidated `revalidatePath("/", "layout")` and the
   owner's profile page. It did not revalidate `/settings`, the page the user is
   standing on. The header updated at once because the header is in the root
   layout. The preview did not, and it was still rendering the `avatarPath` prop
   it was mounted with, which was `null`.

   `revalidatePath` tells *other* surfaces to re-render. It is the wrong tool for
   the surface the user is already looking at, and depending on a second round
   trip to be told what the action already returned is what kept the preview
   wrong. The uploader now holds the key the action confirmed and renders from
   it. The action returns a storage **key**, not a URL, deliberately:
   `UserAvatar` builds the URL itself and refuses anything that is not a key in
   our own bucket, so a key changes nothing about the security model while a URL
   would have handed the component an origin it exists to reject.

2. **Editing your display name left the old name on your public profile.**
   `updateProfileAction` revalidated `revalidatePath(\`/profile/${user.id}\`)`. The
   only profile route is `/profile/[username]`, so a UUID in that segment
   invalidated a cache entry for a URL that does not exist and left the real page
   stale. The update now returns the row, so the username revalidated is the one
   actually stored, and a row RLS refused to return is a reported failure rather
   than a silent success.

3. `/settings` and the root layout are now revalidated by both actions, so the
   header, the preview and the owner's public profile cannot disagree.

## Why this was invisible for so long

Each of these was hidden by the same thing: the surface that appears to prove the
feature works was not the surface that was broken.

| Check | Result while broken |
| --- | --- |
| The database | Correct |
| The action's return value | `ok: true` |
| The header avatar | Updated, immediately |
| The console | No error on a happy path |
| A reload | Fixed it |
| 263 unit tests | Passed |
| 136 database checks | Passed |

Only the specific frame the user was looking at showed the failure. That is the
general lesson, and it is why the guards are pinned on the rendering state
(`data-avatar-state`), on the revalidation targets, and on the confirmed key, and
why each of those guards was verified to fail when its defect is reintroduced.

## Accessibility

The image is `alt=""` and the initials are `aria-hidden`, so the avatar
contributes nothing to the accessibility tree. That is correct for every call
site, because each pairs the avatar with the person's name: the profile `h1`, the
seller name beside the card, the account email in Settings, and the header
button's own `aria-label`.

## Known limitation

The storage key is deterministic (`<userId>/avatar.<ext>`), so replacing a
picture with the same format reuses the same key, and therefore the same
`/_next/image` optimiser URL, which is cached on our own origin for up to a year.
The storage object itself carries a one-hour `cacheControl`, so the underlying
bytes refresh within an hour, but the optimiser entry in front of it does not.

Observed while verifying this work: after repeated upload-and-remove cycles
against a single test account, the optimiser continued to return a cached
response for the avatar URL while a direct fetch of the same underlying object
returned fresh bytes. This is a real staleness window for anyone who replaces a
picture in the same format.

It is not fixed, because the fix is a schema change: a version column on
`profiles` that every avatar URL carries, so the optimiser's cache key changes
with the content. That is worth doing, and it should be a deliberate piece of
work rather than a drive-by change. The upload stores
`cacheControl: "3600"` on the object, which bounds the underlying window but not
the optimiser's.

## Guards

| File | What it holds |
| --- | --- |
| `src/components/profile/user-avatar.test.ts` | The states are visually exclusive and the image can still load; the image is never rendered only once loaded; zero-size is a failure; the `sizes` hint survives; the states are exposed for a test to assert. |
| `src/components/profile/avatar-uploader.test.ts` | The preview renders from the confirmed key and never the raw prop; the key is confirmed on success and cleared on failure and removal; the server returns a key and never a URL; a server value still overrides the local one. |
| `src/server/actions/revalidate-paths.test.ts` | No profile revalidation is built from a user id; a change to your own details revalidates `/settings` and the root layout; the owner's profile page is revalidated by username. |
| `e2e/avatar.spec.ts` | Exactly one visible state per frame in Settings, the header and the profile at 390px and 1440px, and a route-aborted case proving a dead object ends at letters with no image left in the DOM. |
| `scripts/db/verify-engine.mjs` | The avatar bucket is namespaced, traversal is refused, a user cannot point at another's key, and the cleanup leaves every real account's picture exactly as it found it. |
