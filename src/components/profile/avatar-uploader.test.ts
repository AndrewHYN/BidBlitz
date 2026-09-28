import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: the Settings preview shows the picture the moment the action confirms
 * it, without waiting to be told.
 *
 * ## The bug
 *
 * Uploading a profile picture stored the object, updated `profiles.avatar_path`,
 * and updated the header avatar at once. The preview, in the same page, went on
 * showing the user's initials.
 *
 * The cause was that the preview rendered `avatarPath`, a prop from the server
 * component, and nothing handed that component a new value. The blob preview was
 * discarded the moment the action returned, so the frame fell back to a prop that
 * was still `null` - and stayed there for as long as the page was open.
 *
 * This was invisible from every angle that looks like it should catch it. The
 * database was correct. The action returned `{ ok: true }`. The header, on the
 * same page, showed the new picture. A reload fixed it. Any check aimed at the
 * write, the return value, or the header would have passed. Only the specific
 * frame the user was looking at showed the failure.
 *
 * `revalidatePath` is for telling other surfaces to re-render. It is the wrong
 * tool for the surface the user is already looking at, and relying on it for that
 * is what made the preview wrong.
 *
 * ## What is asserted
 *
 * The component holds the key the action confirmed and renders from it. It is a
 * KEY, not a URL, on purpose: `UserAvatar` builds the URL itself and refuses
 * anything that is not a key in our own bucket, so a key changes nothing about the
 * security model while a URL would have been an origin the component renders.
 */

const SOURCE = readFileSync(
  join(process.cwd(), "src", "components", "profile", "avatar-uploader.tsx"),
  "utf8"
);
const ACTION = readFileSync(
  join(process.cwd(), "src", "server", "actions", "avatar.ts"),
  "utf8"
);

/** Source with comments removed, so prose about the bug cannot match itself. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("avatar uploader rendering state", () => {
  it("renders the preview from the confirmed key, not the unrefreshed prop", () => {
    const src = code(SOURCE);
    // Rendering the raw prop is the bug. The preview must read the effective
    // value, which prefers a confirmed key and falls back to the prop.
    expect(src).toMatch(/const effectiveKey = confirmedKey \?\? avatarPath;/);
    expect(src).toMatch(/avatarPath=\{effectiveKey\}/);
    // A frame rendered straight from the prop would reintroduce it.
    expect(src).not.toMatch(/avatarPath=\{avatarPath\}/);
  });

  it("confirms the key when the upload succeeds", () => {
    const src = code(SOURCE);
    expect(src).toMatch(/setConfirmedKey\(result\.avatarKey\)/);
  });

  it("clears the confirmed key on failure and on removal", () => {
    const src = code(SOURCE);
    const clears = src.match(/setConfirmedKey\(null\)/g) ?? [];
    // At least two: the failure paths and the removal path. A single one would
    // mean a rejected upload or a removed picture could still be painted.
    expect(clears.length).toBeGreaterThanOrEqual(2);
  });

  it("has the server hand back a key, never a URL, for the client to render", () => {
    expect(ACTION).toMatch(/avatarKey: string \| null;/);
    // A raw URL here would be an arbitrary origin reaching the avatar component,
    // which exists precisely to refuse them.
    expect(ACTION).toMatch(/avatarKey: key/);
    expect(code(SOURCE)).not.toMatch(/avatarUrlFor\(result\.avatarUrl\)|src=\{result\.avatarUrl\}/);
  });

  it("still lets a server value override the local one", () => {
    const src = code(SOURCE);
    // `confirmedKey ?? avatarPath`: the prop is the fallback, so once the server
    // does catch up the server's value is the one that is rendered.
    expect(src).toMatch(/confirmedKey \?\? avatarPath/);
    // And NOT the other way round, which would let a stale local value survive a
    // change made elsewhere.
    expect(src).not.toMatch(/avatarPath \?\? confirmedKey/);
  });
});
