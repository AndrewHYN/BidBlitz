/**
 * Loads the repo-root `.env.local` into `process.env` for plain Node scripts.
 *
 * Next.js reads `.env.local` for us during `next dev` / `next build`, but the
 * database tooling runs as bare `node scripts/...` and would otherwise see an
 * empty environment. That is precisely how hardcoded credential fallbacks end
 * up in source: the script "worked" without configuration.
 *
 * This keeps every credential in the gitignored file where it belongs.
 * Never print values loaded here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Read .env.local without overwriting variables already set by the shell. */
export function loadLocalEnv() {
  const file = join(REPO_ROOT, ".env.local");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (key in process.env) continue; // a real environment variable wins
    process.env[key] = raw.trim().replace(/^["'](.*)["']$/, "$1");
  }
}

/** Return a required variable or exit with an actionable message. */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `\n[env] ${name} is not set.\n` +
        `  Copy .env.example to .env.local and fill it in,\n` +
        `  or export ${name} in your shell.\n`
    );
    process.exit(1);
  }
  return value;
}

/** Supabase project ref, derived from NEXT_PUBLIC_SUPABASE_URL when unset. */
export function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
}
