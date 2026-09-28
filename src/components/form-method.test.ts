import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: every `<form>` must declare a `method` (or a server `action`).
 *
 * Why this test exists — it is a real production defect, found by looking at a
 * live browser rather than by reading code.
 *
 * Every form in this app is driven by `onSubmit` + a server action. That works
 * only once React has hydrated. Before hydration the element is an ordinary
 * HTML form, and **a form with no `method` attribute defaults to GET**. A user
 * on a slow connection, on a low-end phone, or one who simply types faster than
 * the bundle loads, presses Enter and gets a native GET submission — which
 * appends every field to the URL as a query string.
 *
 * On the login form that is a password in the address bar: in browser history,
 * in proxy and CDN access logs, and available to be sent in the `Referer` of
 * whatever the page loads next. Observed exactly, in production, when a
 * Playwright run navigated to:
 *
 *   /login?email=buyer1%40bidblitz.test&password=...&password=...
 *
 * TypeScript cannot see this, ESLint has no rule for it, and the code looks
 * correct. A rule the compiler does not enforce needs its own test.
 *
 * The fix is `method="post"` on the action-driven forms: an un-hydrated submit
 * then fails visibly instead of leaking. The genuine navigation forms (the
 * search boxes) declare `method="get"` explicitly, because a query string is
 * the correct result there and they carry no secrets.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(full)) && !isTest(full)) {
      // Test files are excluded on purpose: this file mentions `<form` in its
      // own strings, and a fixture string is not an app form. Counting them
      // would make the scan find itself and then demand that a test string
      // declare a method.
      out.push(full);
    }
  }
  return out;
}

function isTest(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

/** Strip comments so prose about forms cannot match. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

interface FoundForm {
  file: string;
  line: number;
  tag: string;
}

function findForms(): FoundForm[] {
  const found: FoundForm[] = [];
  for (const file of walk(join(process.cwd(), "src"))) {
    const src = code(file);
    let at = src.indexOf("<form");
    while (at !== -1) {
      const close = src.indexOf(">", at);
      if (close === -1) break;
      found.push({
        file: relative(process.cwd(), file),
        line: src.slice(0, at).split("\n").length,
        tag: src.slice(at, close + 1),
      });
      at = src.indexOf("<form", close);
    }
  }
  return found;
}

const forms = findForms();

/** The forms whose fields must never be able to reach a URL. */
const CREDENTIAL_FORMS = ["login-form.tsx", "signup-form.tsx"];

describe("form submission method", () => {
  it("finds the forms to check (a silently-empty scan would pass forever)", () => {
    expect(forms.length).toBeGreaterThanOrEqual(9);
  });

  it("every form declares a method or a server action", () => {
    const undeclared = forms.filter(
      (f) => !/method\s*=/.test(f.tag) && !/action\s*=\s*{/.test(f.tag)
    );
    expect(
      undeclared,
      undeclared.map((f) => `${f.file}:${f.line}  ${f.tag.replace(/\s+/g, " ")}`).join("\n")
    ).toEqual([]);
  });

  it("no form silently falls back to the browser's default of GET", () => {
    const defaulted = forms
      .filter((f) => /method\s*=/.test(f.tag))
      .filter((f) => !/method\s*=\s*"(post|get|dialog)"/.test(f.tag));
    expect(
      defaulted,
      defaulted.map((f) => `${f.file}:${f.line}  ${f.tag.replace(/\s+/g, " ")}`).join("\n")
    ).toEqual([]);
  });

  it("the credential forms are POST, so a password can never reach a URL", () => {
    for (const name of CREDENTIAL_FORMS) {
      const matches = forms.filter((f) => f.file.endsWith(name));
      expect(matches.length, `no <form> found in ${name}`).toBeGreaterThan(0);
      for (const m of matches) {
        expect(
          /method\s*=\s*"post"/.test(m.tag),
          `${m.file}:${m.line} must declare method="post" — a pre-hydration native ` +
            `submit would otherwise put the password in the query string. ` +
            `Found: ${m.tag.replace(/\s+/g, " ")}`
        ).toBe(true);
      }
    }
  });

  it("no form mixes a server action with a GET default", () => {
    // The dangerous combination: a form whose values must stay out of the URL
    // while still submitting the way a link would.
    const mixed = forms.filter(
      (f) =>
        /onSubmit\s*=/.test(f.tag) &&
        !/method\s*=/.test(f.tag) &&
        !/action\s*=\s*{/.test(f.tag)
    );
    expect(mixed.map((f) => `${f.file}:${f.line}`)).toEqual([]);
  });
});
