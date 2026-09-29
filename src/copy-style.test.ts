import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guard: no em dash in any string a user can read.
 *
 * ## Why
 *
 * An em dash is a typographic device for printed prose. On a screen it reads as
 * decorative punctuation, it is announced as a pause that does not exist, and in
 * a product that promises plain language it undercuts the claim. BidBlitz writes
 * for people committing money to second-hand goods, so the copy has to read as
 * though a person wrote it.
 *
 * ## How it decides what is copy
 *
 * This uses the TypeScript parser rather than a regular expression, because the
 * distinction that matters here is not a pattern. It is the difference between
 * a string a person reads and a string that is an identifier, and only a parser
 * knows that reliably.
 *
 * The first version of this test hand-rolled a comment stripper and guessed where
 * regular expressions began. It reported the middle of multi-line engineering
 * comments as though they were product copy, which is worse than no test at all:
 * it would have pushed a person to delete the reasoning behind a decision to
 * satisfy a style rule. The parser has no such failure mode, because a comment
 * is not a node and a string literal is.
 *
 * So the rule is:
 *
 *   in scope   JSX text, and string literals (including template literals)
 *   out scope  comments, identifiers, class names, routes, test ids, and any
 *              string that is not reachable as prose
 *
 * A class name, a route or a storage key may contain a dash. Changing one would
 * change behaviour, not typography.
 *
 * ## The one carve-out
 *
 * `src/lib/avatar.ts` and the avatar actions build a message with a template
 * literal, and are NOT exempt. Those strings are shown to a person, so they are
 * in scope like any other.
 */

const EM_DASH = "—";

/** Property names whose string value is an identifier, not prose. */
const IDENTIFIER_PROPS = new Set([
  "className",
  "class",
  "href",
  "src",
  "id",
  "name",
  "type",
  "method",
  "role",
  "action",
  "variant",
  "size",
  "value",
  "key",
  "slug",
  "path",
  "storagePath",
  "testId",
  "data-testid",
  "eventKey",
  "as",
  "to",
  "from",
]);

/** Attribute names (lowercased) whose string value is markup or styling. */
const MARKUP_PROPS = /^(class|for|charset|lang|dir|rel|type|href|src|action|method|name|id|role|style|placeholder|defaultvalue|inputmode|autocomplete|content|http-equiv)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(full)) && !isTest(full)) {
      out.push(full);
    }
  }
  return out;
}

function isTest(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

type Offence = { file: string; line: number; text: string };

/**
 * Every piece of prose the parser can see in one file.
 *
 * Reports JSX text and string/template literals, minus anything assigned to a
 * property that is an identifier rather than a word.
 */
function offencesIn(file: string, root: string): Offence[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(file)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS);

  const found: Offence[] = [];
  const lineAt = (pos: number) => source.getLineAndCharacterOfPosition(pos).line + 1;

  const record = (pos: number, value: string) => {
    if (!value.includes(EM_DASH)) return;
    found.push({
      file: relative(root, file),
      line: lineAt(pos),
      text: value.replace(/\s+/g, " ").trim().slice(0, 130),
    });
  };

  /** Is this literal the value of a property that is an identifier? */
  const isIdentifierValue = (node: ts.Node): boolean => {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent)) {
      const name = parent.name;
      const propName = ts.isIdentifier(name)
        ? name.text
        : ts.isStringLiteral(name)
          ? name.text
          : ts.isJsxNamespacedName(name)
            ? name.getText(source)
            : "";
      if (IDENTIFIER_PROPS.has(propName)) return true;
      if (MARKUP_PROPS.test(propName.toLowerCase())) return true;
    }
    // A member expression, an argument to a styling helper, a `testid`, and so
    // on. These are the shapes where a string is data.
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) {
      const callee = parent.expression.name.text;
      if (["cn", "twMerge", "clsx", "join"].includes(callee)) return true;
    }
    if (ts.isPropertyAccessExpression(parent) && parent.name.text === "testid") return true;
    if (ts.isElementAccessExpression(parent)) return true;
    return false;
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      record(node.getStart(source), node.getText(source));
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (!isIdentifierValue(node)) {
        // A template literal's own text nodes are the parts a reader sees.
        record(node.getStart(source), node.getText(source));
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

/**
 * Parsing every source file with the TypeScript compiler costs seconds, not
 * milliseconds, and that is the price of not guessing.
 *
 * It was left on vitest's default 5s budget and failed on a loaded machine while
 * passing on an idle one: 8.3s observed, 5s allowed. A test whose result depends
 * on how busy the machine is is not a test, it is a coin flip, and shipping one
 * would mean the next engineer either retries until it goes green or deletes it.
 *
 * So the cost is declared rather than tolerated. Thirty seconds is generous on
 * purpose: this is a build-time check, and a false failure costs far more than a
 * slow one.
 */
const PARSE_TIMEOUT_MS = 30_000;

describe("user-facing copy", () => {
  const root = process.cwd();
  const files = walk(join(root, "src"));

  it("finds the source files it is meant to scan", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it(
    "does not mistake a comment for copy",
    () => {
      // The hand-rolled scanner reported the middle of multi-line engineering
      // comments. If that ever comes back, this file will fail its own first
      // finding, which is a cheap way to keep the test honest about itself.
      const devComments = readFileSync(
        join(root, "src", "components", "document-page.tsx"),
        "utf8"
      );
      expect(devComments).toContain("Contact details are an object a user acts on");
      const inThatFile = offencesIn(
        join(root, "src", "components", "document-page.tsx"),
        root
      );
      const fromComments = inThatFile.filter((o) => o.text.startsWith("*"));
      expect(fromComments.map((o) => o.text)).toEqual([]);
    },
    PARSE_TIMEOUT_MS
  );

  it(
    "contains no em dash in a string a user can read",
    () => {
    const offences = files.flatMap((f) => offencesIn(f, root));

    expect(
      offences,
      `Em dash found in user-visible copy on ${offences.length} line(s). Rewrite the sentence ` +
        `with a period, a comma, a colon, or parentheses. Do not substitute a double ` +
        `hyphen: that is worse punctuation, not better.\n\n` +
        offences.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join("\n")
      ).toEqual([]);
    },
    PARSE_TIMEOUT_MS
  );
});
