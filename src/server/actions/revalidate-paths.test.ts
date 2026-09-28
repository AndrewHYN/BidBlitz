import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: server actions revalidate the pages that show the data they changed.
 *
 * ## The defect this exists for
 *
 * A user uploaded a profile picture. The header avatar updated at once, the
 * preview in Settings never did: it kept showing their initials for as long as
 * the page stayed open. Storage was correct, the write was correct, and the
 * header proved both, because the header lives in the root layout.
 *
 * The cause is that `uploadAvatarAction` called `revalidatePath("/", "layout")`.
 * That invalidates the layout and the header, and it does not re-render the
 * `/settings` page segment - the page the user is standing on. So the segment
 * kept the `avatar_path` it was rendered with, which was `null`.
 *
 * A second instance of the same mistake sat in `updateProfileAction`, and it was
 * worse because it was silent: the public profile route is `/profile/[username]`
 * and the action revalidated `/profile/${user.id}`. A UUID, in a path segment
 * that expects a username. It threw away a cache entry for a URL that does not
 * exist and left the real one stale, so editing your display name left the old
 * name on your public profile.
 *
 * ## Why a test, when this is "just" a wrong argument
 *
 * TypeScript is happy with both. ESLint has no rule for a revalidation target.
 * Nothing in the compiler's view of the program knows that `/profile/[username]`
 * exists, that it is the only place a display name is shown, or that
 * `revalidatePath` operates on router-cache entries rather than on the DOM.
 *
 * Worse, the bug is invisible on the surface that appears to prove it. The
 * header DID update. Any check that looked at the header, or that looked at the
 * database, or that read the action's return value, would have passed. Only
 * looking at the specific preview the user was looking at found it.
 *
 * So the rules are asserted structurally: the two revalidation bugs are the
 * shapes, and the avatar surfaces are enumerated so a new one is a conscious
 * addition rather than an oversight.
 */

const SRC = join(process.cwd(), "src");
const read = (relative: string) => readFileSync(join(SRC, relative), "utf8");

/** Every revalidation target in the repository, with the line it came from. */
function revalidations(): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === "node_modules" || entry === ".next") continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((text, i) => {
        if (text.includes("revalidatePath(")) {
          out.push({
            file: full.replace(SRC + "\\", "").replace(SRC + "/", ""),
            line: i + 1,
            text: text.trim(),
          });
        }
      });
    }
  };
  walk(SRC);
  return out;
}

describe("server action revalidation", () => {
  const all = revalidations();

  it("finds the revalidations it is meant to police", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("never builds a profile path from a user id", () => {
    // `/profile/[username]` is the only profile route. An id here means a cache
    // entry for a URL that does not exist, and the real page stays stale.
    const offenders = all.filter((r) =>
      /\/profile\/\$\{[^}]*\b(id|user\.id|userId|profile\.id|reviewee\.id)\b/.test(r.text)
    );
    expect(
      offenders.map((o) => `${o.file}:${o.line}  ${o.text}`),
      "A profile revalidation is built from a user id. The route is " +
        "/profile/[username], so this invalidates a URL that does not exist and " +
        "leaves the real profile page stale."
    ).toEqual([]);
  });

  it("revalidates the page the user is standing on when it changes a profile", () => {
    // The user's own name, bio, location and picture are edited on /settings and
    // rendered there, in the root layout header, and on /profile/<username>.
    // All three have to be invalidated or one of them shows the old value.
    for (const file of ["server/actions/avatar.ts", "server/actions/auth.ts"]) {
      const source = read(file);
      expect(
        source,
        `${file} changes the signed-in user's own profile details, so it must ` +
          `revalidatePath("/settings"): that is the page the edit is made on.`
      ).toMatch(/revalidatePath\("\/settings"\)/);
    }
  });

  it("refreshes the root layout for a change the header shows", () => {
    // The header carries the display name and the picture on every page. It
    // lives in the root layout, so a path-level revalidation cannot reach it.
    for (const file of ["server/actions/avatar.ts", "server/actions/auth.ts"]) {
      const source = read(file);
      expect(
        source,
        `${file} changes a value the site header shows, so it must revalidate the ` +
          `root layout rather than a single path.`
      ).toMatch(/revalidatePath\("\/",\s*"layout"\)/);
    }
  });

  it("revalidates the owner's public profile by username", () => {
    const avatar = read("server/actions/avatar.ts");
    expect(avatar).toMatch(/revalidatePath\(`\/profile\/\$\{[^}]*username[^}]*}`\)/);
    const auth = read("server/actions/auth.ts");
    expect(auth).toMatch(/revalidatePath\(`\/profile\/\$\{[^}]*username[^}]*}`\)/);
  });
});
