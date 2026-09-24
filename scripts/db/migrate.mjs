/**
 * Supabase Management API migration runner.
 *
 * PostgREST cannot execute DDL, so migrations go through
 *   POST https://api.supabase.com/v1/projects/{ref}/database/query
 * using a personal access token (sbp_...).
 *
 * Requires SUPABASE_ACCESS_TOKEN. Never requires the DB password, and never
 * puts any privileged key in the browser.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv, requireEnv, projectRef } from "./load-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

loadLocalEnv();

const TOKEN = requireEnv("SUPABASE_ACCESS_TOKEN");
const REF = projectRef() ?? requireEnv("SUPABASE_PROJECT_REF");
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

if (!TOKEN) {
  console.error(
    "\n[db:migrate] SUPABASE_ACCESS_TOKEN is not set.\n" +
      "  Create one at https://supabase.com/dashboard/account/tokens (sbp_...)\n" +
      "  then:  $env:SUPABASE_ACCESS_TOKEN = 'sbp_...'\n"
  );
  process.exit(1);
}

async function runSql(sql) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`HTTP ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function ensureLedger() {
  await runSql(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );
    alter table public.schema_migrations enable row level security;
    drop policy if exists schema_migrations_read on public.schema_migrations;
    create policy schema_migrations_read on public.schema_migrations
      for select using (true);
  `);
}

async function applied() {
  const rows = await runSql("select filename from public.schema_migrations");
  // Management API returns [ [ {col:val} ] ] or [ {col:val} ]
  const first = rows[0];
  if (Array.isArray(first)) return first.map((r) => r.filename);
  if (first && typeof first === "object") return rows.flat().map((r) => r.filename);
  return [];
}

async function main() {
  console.log(`\n[db:migrate] project ${REF}\n`);

  await ensureLedger();
  const done = new Set(await applied());

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[db:migrate] no migration files found");
    return;
  }

  let okCount = 0;
  let skipCount = 0;

  for (const file of files) {
    if (done.has(file)) {
      console.log(`  = ${file} (already applied)`);
      skipCount++;
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    try {
      await runSql(sql);
      await runSql(
        `insert into public.schema_migrations (filename) values ('${file.replace(/'/g, "''")}')`
      );
      console.log(`  + ${file}`);
      okCount++;
    } catch (err) {
      console.error(`\n  ! ${file} FAILED`);
      console.error(`    ${err.message}\n`);
      console.error(
        "[db:migrate] stopping so the schema is never left half-applied.\n" +
          "[db:migrate] fix the file and re-run; applied files are skipped.\n"
      );
      process.exit(1);
    }
  }

  console.log(`\n[db:migrate] ${okCount} applied, ${skipCount} skipped\n`);
}

main().catch((err) => {
  console.error(`[db:migrate] fatal: ${err.message}`);
  process.exit(1);
});
