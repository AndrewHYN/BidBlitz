import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract guard: publish_auction's `first_listing` risk flag must not hold
 * staff listings that carry the live `admin.access` permission.
 *
 * Why this test exists: tsc, ESLint and `next build` cannot read PL/pgSQL,
 * so a regression that either (a) reroutes ordinary first-time sellers out
 * of review, or (b) lets a staff seller skip review via a real risk signal,
 * or (c) silently drops one of the other four signals, would pass every
 * green gate while moderation goes quiet. The rule is enforced in the
 * database; these static assertions pin it on every push. Live execution of
 * the risk branches still needs SQL access.
 *
 * It judges the *effective* definition the way PostgreSQL does — the last
 * `create or replace function public.publish_auction(` in filename (apply)
 * order — so it always reviews the version that would actually run.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

type Definition = { sql: string; file: string; fileSql: string };

function effectiveDefinition(): Definition {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let found: Definition | null = null;
  for (const file of files) {
    const fileSql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match =
      /create or replace function public\.publish_auction\([\s\S]*?\$\$;/.exec(fileSql);
    if (match) found = { sql: match[0], file, fileSql };
  }
  if (!found) {
    throw new Error("public.publish_auction() is defined by no migration");
  }
  return found;
}

const def = effectiveDefinition();

describe("publish_auction risk screen — first_listing vs admin.access", () => {
  it("resolves an effective definition from the migration set", () => {
    expect(def.file).toMatch(/^\d{14}_.+\.sql$/);
    expect(def.sql).toMatch(/^create or replace function/);
  });

  it("B. staff (admin.access) first listings skip ONLY the first_listing flag", () => {
    // The flag is conditional on NOT holding the live permission.
    expect(def.sql).toMatch(
      /if not public\.has_permission\(v_uid, 'admin\.access'\)\s*\n\s*and not exists/
    );
    // Authority is the live RBAC helper, never the legacy boolean.
    expect(def.sql).not.toMatch(/private\.is_admin\(\)/);
    expect(def.sql).not.toMatch(/profiles[^\n]*is_admin/i);
  });

  it("A. ordinary first-time sellers still get first_listing -> PENDING_REVIEW", () => {
    expect(def.sql).toMatch(/'\{"first_listing": true\}'/);
    expect(def.sql).toMatch(
      /x\.seller_id = v_uid and x\.status <> 'DRAFT' and x\.id <> a\.id/
    );
  });

  it("C/D. every other signal still holds staff AND ordinary sellers", () => {
    for (const flag of [
      "reported_seller",
      "prior_takedown",
      "prior_ban",
      "high_value",
    ]) {
      expect(def.sql).toContain(`{"${flag}": true}`);
    }
    // The risky branch and its audit trail are intact.
    expect(def.sql).toMatch(/if v_risky then/);
    expect(def.sql).toMatch(/status = 'PENDING_REVIEW'/);
    expect(def.sql).toMatch(/insert into public\.listing_reviews/);
    expect(def.sql).toMatch(/'REVIEW_SUBMITTED'/);
  });

  it("E. no data backfill, no history rewrite, no other domain touched", () => {
    // No top-level (column-0) data-modifying statements: anything inside
    // the function body is indented, so this catches a backfill only.
    expect(def.fileSql).not.toMatch(/^update\s/im);
    expect(def.fileSql).not.toMatch(/^delete from/im);
    expect(def.fileSql).not.toMatch(/^insert into/im);
    expect(def.fileSql).not.toMatch(
      /public\.(payment_intents|payment_events|transactions|seller_payouts|auction_cancellations|transaction_messages)/i
    );
    // No risk signal was removed.
    for (const flag of [
      "first_listing",
      "reported_seller",
      "prior_takedown",
      "prior_ban",
      "high_value",
    ]) {
      expect(def.sql).toContain(flag);
    }
    // Still the only moderation-related change: exactly one function
    // replaced, no new trigger, no new policy, no new table.
    expect(def.fileSql.match(/create or replace function/g)).toHaveLength(1);
    expect(def.fileSql).not.toMatch(/create trigger/i);
    expect(def.fileSql).not.toMatch(/create policy/i);
    expect(def.fileSql).not.toMatch(/create table/i);
  });
});
