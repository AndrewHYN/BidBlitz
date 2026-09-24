import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: a `"use server"` file may only export async functions.
 *
 * Why this test exists — it caught a production-breaking bug that every other
 * gate missed. `src/server/actions/bid.ts` carried `export { MIN_BID_INTERVAL_MS }`
 * (a number). TypeScript accepted it, ESLint accepted it, and `next build`
 * succeeded — because Next enforces this rule when it *evaluates* the server
 * action module at request time. The result was:
 *
 *   ⨯ Error: A "use server" file can only export async functions, found number.
 *   POST /auction/[id] 500
 *
 * i.e. every bid in the app failed with the client falling back to "we couldn't
 * reach the server", while all CI gates stayed green. A rule the compiler does
 * not enforce needs its own test.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
  }
  return out;
}

const SRC = join(process.cwd(), "src");

const actionFiles = walk(SRC).filter((file) =>
  /^\s*["']use server["'];/.test(readFileSync(file, "utf8"))
);

/** Strip comments so prose like "export async functions" cannot match. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function valueExports(src: string): string[] {
  const problems: string[] = [];

  for (const m of src.matchAll(/export\s+(?:const|let|var|class|enum)\s+([A-Za-z0-9_$]+)/g)) {
    problems.push(m[1]);
  }
  if (/export\s+default\b/.test(src)) problems.push("<default>");
  for (const m of src.matchAll(/export\s*\*\s*from\s*["'][^"']+["']/g)) problems.push(m[0]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "");
      if (name) problems.push(`{ ${name} }`);
    }
  }
  return problems;
}

describe("server action contract", () => {
  it("finds the action modules", () => {
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  it.each(actionFiles)("only exports async functions: %s", (file) => {
    const src = code(file);

    // Names declared as async functions here are legal to re-export.
    const asyncFunctions = new Set(
      [...src.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1])
    );

    const offenders = valueExports(src).filter((name) => {
      const bare = name.replace(/^\{\s*|\s*\}$/g, "");
      return !asyncFunctions.has(bare);
    });

    expect(
      offenders,
      `${file} is a "use server" module: every export must be an async function. ` +
        `Move value exports (constants, types live elsewhere) into a plain module and import them.`
    ).toEqual([]);
  });
});
