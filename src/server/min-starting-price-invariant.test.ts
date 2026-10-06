import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract guard: new auctions must start at or above 100 cents (Linkwa's
 * published $1.00 minimum), enforced by the database because the client and
 * the action schema can be bypassed.
 *
 * Why this test exists: `next build`, ESLint and tsc cannot read PL/pgSQL,
 * so a regression that drops the floor (or that "fixes" it by rewriting
 * history) would pass every green gate while a sub-$1 auction ships. These
 * assertions are static on purpose and run on every push; live verification
 * of the trigger still needs SQL access.
 *
 * It MUST also pin that the rule is insert-only: historical sub-$1 rows from
 * before the floor remain valid, readable and writable for status changes.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

function effectiveFunctionSql(): { sql: string; file: string; fileSql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let found: { sql: string; file: string; fileSql: string } | null = null;
  for (const file of files) {
    const fileSql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = /create or replace function public\.auctions_enforce_min_starting_price\(\)[\s\S]*?\$\$;/.exec(
      fileSql
    );
    if (match) found = { sql: match[0], file, fileSql };
  }
  if (!found) {
    throw new Error(
      "public.auctions_enforce_min_starting_price() is defined by no migration"
    );
  }
  return found;
}

const def = effectiveFunctionSql();

describe("minimum starting price invariant — auctions_enforce_min_starting_price()", () => {
  it("resolves an effective definition from the migration set", () => {
    expect(def.file).toMatch(/^\d{14}_.+\.sql$/);
    expect(def.sql).toMatch(/^create or replace function/);
  });

  it("rejects NEW auctions below 100 cents and accepts exactly 100", () => {
    expect(def.sql).toMatch(/new\.starting_bid_minor/);
    expect(def.sql).toMatch(/<\s*100/);
    expect(def.sql).toMatch(/raise exception 'below_minimum_price'/);
    // The floor is cents, not a float: "1.00" would be float money.
    expect(def.sql).not.toMatch(/1\.00/);
  });

  it("is BEFORE INSERT only — historical rows are never rewritten", () => {
    expect(def.fileSql).toMatch(/before insert on public\.auctions/i);
    // No UPDATE trigger, no CHECK that would revalidate old rows, no
    // backfill: existing sub-$1 auctions stay valid and readable.
    expect(def.fileSql).not.toMatch(/before update/i);
    expect(def.fileSql).not.toMatch(/after update/i);
    expect(def.fileSql).not.toMatch(/add constraint[\s\S]*check/i);
    expect(def.fileSql).not.toMatch(/\bupdate\s+public\.auctions\b/i);
    expect(def.fileSql).not.toMatch(/\bdelete from\s+public\.auctions\b/i);
    expect(def.fileSql).not.toMatch(/\binsert into\s+public\.auctions\b/i);
  });

  it("does not touch provider selection, webhooks, payouts or settlement", () => {
    expect(def.fileSql).not.toMatch(/public\.(payment_intents|payment_events|transactions|seller_payouts)/i);
  });
});
