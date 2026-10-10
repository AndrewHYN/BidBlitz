import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract guard: `delivery_confirmed_at` is an explicit fulfilment fact.
 *
 * Why this test exists: the compiler, ESLint and `next build` cannot read a
 * PL/pgSQL trigger, so a regression that re-opens a delivery shortcut would
 * sail through every CI gate while the payout queue starts claiming sellers
 * delivered when nobody confirmed it. The rule is enforced in the database;
 * this test pins the rule where a pull request can be reviewed.
 *
 * It resolves the *effective* definition the way PostgreSQL does - the last
 * `create or replace function private.seller_payouts_protect_state()` in
 * filename (apply) order - so it always judges the version that is actually
 * running, not a historical file that has since been superseded.
 *
 * Live execution of these cases still needs SQL access; see the verification
 * block in the migration header. These assertions are static on purpose: they
 * are the gate that runs on every push.
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
    const match = /create or replace function private\.seller_payouts_protect_state\(\)[\s\S]*?\$\$;/.exec(
      fileSql
    );
    if (match) found = { sql: match[0], file, fileSql };
  }

  if (!found) {
    throw new Error("private.seller_payouts_protect_state() is defined by no migration");
  }
  return found;
}

/** `(old.status = 'X' and new.status in (...))` branches -> the transition map. */
function transitionMap(sql: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const branch = /\(old\.status = '([A-Z_]+)'[\s\S]*?and new\.status in \(([^)]*)\)\)/g;
  for (const m of sql.matchAll(branch)) {
    map[m[1]] = [...m[2].matchAll(/'([A-Z_]+)'/g)].map((t) => t[1]);
  }
  return map;
}

const def = effectiveDefinition();
const map = transitionMap(def.sql);

const STAMP =
  /if new\.status = '([A-Z_]+)' and new\.delivery_confirmed_at is null then\s+new\.delivery_confirmed_at := clock_timestamp\(\);/;

const deliveryWrites = () =>
  [...def.sql.matchAll(/new\.delivery_confirmed_at\s*:=\s*[^;]+;/g)].map((m) => m[0]);

describe("payout delivery invariant — private.seller_payouts_protect_state()", () => {
  it("resolves an effective definition from the migration set", () => {
    expect(def.file).toMatch(/^\d{14}_.+\.sql$/);
    // Idempotent by construction: replace, never drop-and-create.
    expect(def.sql).toMatch(/^create or replace function/);
    expect(def.fileSql).not.toMatch(/\bdrop\s+(function|table|trigger|policy)\b/i);
    // This migration only rewrites the function: it never backfills data.
    expect(def.fileSql).not.toMatch(/\bupdate\s+public\.seller_payouts\b/i);
    expect(def.fileSql).not.toMatch(/\b(insert into|delete from)\b/i);
  });

  it("a) refuses WAITING_FOR_FULFILMENT -> PAYOUT_PENDING", () => {
    expect(map["WAITING_FOR_FULFILMENT"]).toEqual([
      "DELIVERY_CONFIRMED",
      "HELD",
      "DISPUTED",
    ]);
    expect(map["WAITING_FOR_FULFILMENT"]).not.toContain("PAYOUT_PENDING");
  });

  it("b) refuses WAITING_FOR_FULFILMENT -> PAYOUT_DUE", () => {
    expect(map["WAITING_FOR_FULFILMENT"]).not.toContain("PAYOUT_DUE");
    // A two-hop route into PAYOUT_DUE does exist (through HELD, DISPUTED or
    // DELIVERY_CONFIRMED), and it must be - that is the retry path. What makes
    // it safe is that the delivery guard below is not conditioned on the
    // source state: no branch reaches PAYOUT_DUE without passing it, and the
    // guard runs before the only place delivery is ever written.
    const mapEnd = def.sql.indexOf("raise exception 'payout_invalid_transition'");
    const guardIndex = def.sql.indexOf("raise exception 'payout_delivery_not_confirmed'");
    const stampIndex = def.sql.indexOf("new.delivery_confirmed_at := clock_timestamp()");
    expect(guardIndex).toBeGreaterThan(mapEnd);
    expect(guardIndex).toBeLessThan(stampIndex);
    expect(def.sql.slice(mapEnd, guardIndex)).not.toMatch(/old\.status/);
  });

  it("c) creates delivery_confirmed_at only on entering DELIVERY_CONFIRMED", () => {
    const stamp = STAMP.exec(def.sql);
    expect(stamp).not.toBeNull();
    expect(stamp?.[1]).toBe("DELIVERY_CONFIRMED");
    // Exactly two writers exist in the whole function: create + clear.
    expect(deliveryWrites()).toHaveLength(2);
    expect(deliveryWrites()[0]).toContain("clock_timestamp()");
    expect(deliveryWrites()[1]).toContain("null");
  });

  it("d) PAYOUT_PENDING never creates or modifies the delivery timestamp", () => {
    expect(def.sql).not.toMatch(
      /new\.status = 'PAYOUT_PENDING' and new\.delivery_confirmed_at is null\s+then\s+new\.delivery_confirmed_at/
    );
    expect(STAMP.exec(def.sql)?.[1]).not.toBe("PAYOUT_PENDING");
  });

  it("e) PAYOUT_DUE never creates or modifies the delivery timestamp", () => {
    expect(STAMP.exec(def.sql)?.[1]).not.toBe("PAYOUT_DUE");
    expect(deliveryWrites().filter((w) => w.includes("clock_timestamp"))).toHaveLength(1);
  });

  it("f) HELD -> PAYOUT_DUE is rejected when delivery_confirmed_at is NULL", () => {
    expect(
      def.sql.match(
        /new\.status = 'PAYOUT_DUE' and new\.delivery_confirmed_at is null\s+then\s+raise exception 'payout_delivery_not_confirmed'/
      )
    ).not.toBeNull();
    // The branch itself exists, so the refusal comes from the delivery rule.
    expect(map["HELD"]).toContain("PAYOUT_DUE");
  });

  it("g) HELD -> PAYOUT_DUE still succeeds when delivery was confirmed", () => {
    // Same guard as (f): it only raises on NULL, so a held payout that was
    // legitimately delivered - the provider-failure retry - can move.
    expect(map["HELD"]).toContain("PAYOUT_DUE");
    expect(map["HELD"]).toContain("PAYOUT_PENDING");
    expect(map["PAYOUT_PENDING"]).toContain("PAYOUT_DUE");
    expect(
      def.sql.match(
        /new\.status = 'PAYOUT_DUE' and new\.delivery_confirmed_at is not null\s+then\s+raise/
      )
    ).toBeNull();
  });

  it("h) PAID_OUT never creates the delivery timestamp", () => {
    expect(STAMP.exec(def.sql)?.[1]).not.toBe("PAID_OUT");
    expect(deliveryWrites().filter((w) => w.includes("PAID_OUT"))).toHaveLength(0);
  });

  it("i) PAID_OUT stays terminal and the historical NULL-delivery row stays valid", () => {
    expect(map["PAID_OUT"] ?? []).toEqual([]);
    expect(def.sql).toContain("raise exception 'payout_paid_out_immutable'");
    // The frozen block covers the delivery fact, so a PAID_OUT row can neither
    // gain nor lose delivery after the fact - including our reconciled fixture.
    expect(
      def.sql.match(
        /or new\.paid_at is distinct from old\.paid_at\s+or new\.delivery_confirmed_at is distinct from old\.delivery_confirmed_at then/
      )
    ).not.toBeNull();
    // Nothing in this migration may invent delivery for it.
    expect(def.fileSql).not.toMatch(/\bupdate\s+public\.seller_payouts\b/i);
  });

  it("the delivery fact can only be written by this function", () => {
    expect(
      def.sql.match(
        /if new\.delivery_confirmed_at is distinct from old\.delivery_confirmed_at\s+and not \(new\.status = 'WAITING_FOR_FULFILMENT'\s+and new\.delivery_confirmed_at is null\) then\s+raise exception 'payout_delivery_immutable'/
      )
    ).not.toBeNull();
  });

  it("keeps the hardening the payout table already relies on", () => {
    expect(def.sql).toContain("raise exception 'payout_money_immutable'");
    expect(def.sql).toContain("raise exception 'payout_state_immutable'");
    expect(def.sql).toContain("raise exception 'payout_invalid_transition'");
    expect(def.sql).toContain("raise exception 'payout_reference_required'");
    expect(def.sql).toContain("raise exception 'payout_paid_out_immutable'");
    expect(def.sql).toContain(
      "if current_user not in ('postgres', 'supabase_admin', 'service_role')"
    );
    expect(def.sql).toContain("language plpgsql set search_path = ''");
    // Nothing here may weaken grants, RLS or policies.
    expect(def.fileSql).not.toMatch(/\b(grant|revoke|drop policy|disable row level security)\b/i);
    expect(def.fileSql).not.toMatch(/\balter table\b/i);
    // Money fields still frozen for every role, engine included.
    for (const field of ["id", "transaction_id", "seller_id", "amount_minor", "currency", "created_at"]) {
      expect(def.sql).toContain(`new.${field} is distinct from old.${field}`);
    }
  });

  it("keeps the fulfilment chain the admin console offers", () => {
    // The console mirrors this map (payout-controls.tsx); if the two drift,
    // an operator clicks a button the database refuses.
    expect(map).toEqual({
      WAITING_FOR_FULFILMENT: ["DELIVERY_CONFIRMED", "HELD", "DISPUTED"],
      DELIVERY_CONFIRMED: ["PAYOUT_PENDING", "PAYOUT_DUE", "HELD", "DISPUTED"],
      PAYOUT_PENDING: ["DELIVERY_CONFIRMED", "PAYOUT_DUE", "HELD", "DISPUTED"],
      PAYOUT_DUE: ["PAID_OUT", "HELD", "DISPUTED"],
      HELD: [
        "WAITING_FOR_FULFILMENT",
        "DELIVERY_CONFIRMED",
        "PAYOUT_PENDING",
        "PAYOUT_DUE",
        "DISPUTED",
      ],
      DISPUTED: [
        "WAITING_FOR_FULFILMENT",
        "DELIVERY_CONFIRMED",
        "PAYOUT_PENDING",
        "PAYOUT_DUE",
        "HELD",
      ],
    });
  });
});

describe("the admin console mirrors the enforced state machine", () => {
  const consoleSrc = readFileSync(
    join(process.cwd(), "src/components/dashboard/payout-controls.tsx"),
    "utf8"
  );

  function consoleMap(): Record<string, string[]> {
    const start = consoleSrc.indexOf("const NEXT_ACTIONS");
    if (start < 0) throw new Error("NEXT_ACTIONS not found in payout-controls.tsx");
    const block = consoleSrc.slice(start, consoleSrc.indexOf("};", start));
    const out: Record<string, string[]> = {};
    for (const m of block.matchAll(/([A-Z_]+):\s*\[([^\]]*)\]/g)) {
      out[m[1]] = [...m[2].matchAll(/"([A-Z_]+)"/g)].map((t) => t[1]);
    }
    return out;
  }

  it("offers only legal manual transitions; PAYOUT_DUE requires the provider-only claim", () => {
    const offered = consoleMap();
    expect(Object.keys(offered).sort()).toEqual([
      "DELIVERY_CONFIRMED",
      "DISPUTED",
      "HELD",
      "PAID_OUT",
      "PAYOUT_DUE",
      "PAYOUT_PENDING",
      "WAITING_FOR_FULFILMENT",
    ]);
    // The SQL transition map includes PAYOUT_DUE for the backend's exclusive
    // service claim, but that is intentionally NOT a manual staff control.
    // The migration creates a trigger to reject browser claims at DB level.
    for (const [state, targets] of Object.entries(offered)) {
      expect(targets).toEqual((map[state] ?? []).filter((to) => to !== "PAYOUT_DUE"));
    }
    const migration = readFileSync(join(process.cwd(),
      "supabase/migrations/20261010000122_operations_finance_roles_and_instruction_20261010.sql"), "utf8");
    expect(migration).toContain("provider_payout_due_only");
    expect(migration).toContain("auth.role() <> 'service_role'");
    const adminActions = readFileSync(join(process.cwd(),
      "src/components/dashboard/admin-actions.tsx"), "utf8");
    expect(adminActions).toContain('parsed.data.status === "PAYOUT_DUE"');
  });

  it("never offers \"Mark payout due\" before delivery is confirmed", () => {
    expect(consoleSrc).toContain('to !== "PAYOUT_DUE" || Boolean(deliveryConfirmedAt)');
    const page = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");
    expect(page).toContain("deliveryConfirmedAt={row.deliveryConfirmedAt}");
  });

  it("gives the operator a readable reason instead of a raw database code", () => {
    const actions = readFileSync(
      join(process.cwd(), "src/components/dashboard/admin-actions.tsx"),
      "utf8"
    );
    expect(actions).toContain('m.includes("payout_delivery_not_confirmed")');
    expect(actions).toContain('m.includes("payout_delivery_immutable")');
  });
});
