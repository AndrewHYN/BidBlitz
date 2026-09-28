/**
 * Remove Playwright/e2e fixture data from the live database.
 *
 * WHY THIS EXISTS
 * The end-to-end suite creates REAL rows in whatever Supabase project it points
 * at: a published auction, an uploaded 1x1 PNG, real bids from the QA accounts.
 * Until 2026-09-28 nothing removed them. Verified that day, production held ten
 * listings titled "Race muk7t6qg-...", "RLS muk7x9kz-...", "Outbid muk7w9nr-...",
 * owned by the QA test profile, each with a one-pixel photo, and a first-time
 * visitor saw all ten on the homepage. That is fabricated activity in a
 * commercial product, which is exactly what must never ship.
 *
 * WHAT IT MATCHES, AND HOW SAFELY
 * A listing is only ever deleted when BOTH hold:
 *   1. the seller's email is a QA address (auth.users.email like '%@bidblitz.test')
 *   2. the title matches the suite's own naming scheme exactly:
 *      "<Prefix> <base36 timestamp>-<6 base36 chars>", where <Prefix> is one of
 *      the prefixes the specs pass to `createListing()`.
 * A real listing cannot match that, and a QA account's hand-made listing cannot
 * match it either. Every candidate is printed before anything is removed, and
 * nothing is removed unless the caller passes --yes.
 *
 * Storage is handled separately and more conservatively: an object in the
 * auction-images bucket is an orphan if no `auction_images` row points at it and
 * it is more than an hour old (the margin covers an in-flight upload whose row
 * has not been written yet). An orphan is unreferenced by definition, so this
 * cannot remove a live image.
 *
 * ORDER matters and is enforced by the foreign keys: reviews, then the payout
 * audit trail and payouts (payouts RESTRICT the transaction), then payment
 * events, then transactions, then bids, then images, then the auctions
 * themselves, then the unreferenced storage objects.
 *
 * Run:  node scripts/db/cleanup-e2e-fixtures.mjs --yes
 */
import { loadLocalEnv, requireEnv, projectRef } from "./load-env.mjs";

loadLocalEnv();
const TOKEN = requireEnv("SUPABASE_ACCESS_TOKEN");
const REF = projectRef() ?? requireEnv("SUPABASE_PROJECT_REF");

const dryRun = !process.argv.includes("--yes");

/** Exactly the prefixes `e2e/*.spec.ts` pass to `createListing()`. */
const PREFIXES = ["Race", "Countdown", "Loop", "Outbid", "RLS", "E2E listing"];

// "<Prefix> " + base36 millisecond stamp + "-" + 6 base36 chars.
// Anchored, so nothing that merely contains a prefix is matched.
const escaped = PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const TITLE_RE = `^(${escaped}) [a-z0-9]{4,12}-[a-z0-9]{6}$`;

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${body.slice(0, 300)}`);
  return body;
}

const rows = (x) => (Array.isArray(x) ? x : []);

const orphanObjects = rows(
  JSON.parse(
    await sql(`
      select o.bucket_id, o.name
        from storage.objects o
       where o.bucket_id = 'auction-images'
         and o.created_at < now() - interval '1 hour'
         and not exists (
           select 1 from public.auction_images i
            where i.storage_path = o.bucket_id || '/' || o.name
         )
       order by o.created_at
    `)
  )
);

const fixtures = rows(
  JSON.parse(
    await sql(`
      select a.id::text as auction_id, a.title, u.email as seller_email
        from public.auctions a
        join auth.users u on u.id = a.seller_id
       where u.email like '%@bidblitz.test'
         and a.title ~ '${TITLE_RE}'
       order by a.created_at
    `)
  )
);

if (fixtures.length === 0 && orphanObjects.length === 0) {
  console.log("[db:cleanup-e2e] no e2e fixtures and no orphan images - nothing to do.");
  process.exit(0);
}

if (fixtures.length > 0) {
  const owners = [...new Set(fixtures.map((f) => f.seller_email))].join(", ");
  console.log(
    `\n[db:cleanup-e2e] ${fixtures.length} e2e fixture listing(s), owned by ${owners}\n`
  );
  for (const f of fixtures) console.log(`  ${f.auction_id}  ${f.title}`);
  console.log("");
}
if (orphanObjects.length > 0) {
  console.log(
    `[db:cleanup-e2e] ${orphanObjects.length} unreferenced storage object(s)\n`
  );
  for (const o of orphanObjects) console.log(`  ${o.bucket_id}/${o.name}`);
  console.log("");
}

if (dryRun) {
  console.log(
    "[db:cleanup-e2e] DRY RUN - nothing was deleted. Re-run with --yes to remove them."
  );
  process.exit(0);
}

if (fixtures.length > 0) {
  const ids = fixtures.map((f) => `'${f.auction_id}'`).join(",");
  const steps = [
    [
      "reviews",
      `delete from public.reviews where transaction_id in (select id from public.transactions where auction_id in (${ids}))`,
    ],
    [
      "payout audit rows",
      `delete from public.seller_payout_events where payout_id in (select id from public.seller_payouts where transaction_id in (select id from public.transactions where auction_id in (${ids})))`,
    ],
    [
      "payouts",
      `delete from public.seller_payouts where transaction_id in (select id from public.transactions where auction_id in (${ids}))`,
    ],
    [
      "payment events",
      `delete from public.payment_events where transaction_id in (select id from public.transactions where auction_id in (${ids}))`,
    ],
    [
      "transactions",
      `delete from public.transactions where auction_id in (${ids})`,
    ],
    ["bids", `delete from public.bids where auction_id in (${ids})`],
    [
      "notifications",
      `delete from public.notifications where auction_id in (${ids})`,
    ],
    [
      "auction images",
      `delete from public.auction_images where auction_id in (${ids})`,
    ],
    ["auctions", `delete from public.auctions where id in (${ids})`],
  ];
  for (const [label, query] of steps) {
    await sql(query);
    console.log(`[db:cleanup-e2e] deleted ${label}`);
  }
}

// Storage last, through the Storage API: deleting the row alone would orphan
// the blob. Only HTTP 2xx counts as removed; anything else is reported, never
// quietly swallowed.
if (orphanObjects.length > 0) {
  const pub = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SECRET_KEY");
  let removed = 0;
  for (const o of orphanObjects) {
    const encoded = String(o.name).split("/").map(encodeURIComponent).join("/");
    const url = `${pub}/storage/v1/object/${o.bucket_id}/${encoded}`;
    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        removed += 1;
      } else {
        const body = await res.text().catch(() => "");
        console.log(
          `[db:cleanup-e2e] storage ${res.status} for ${o.name} - ${body.slice(0, 120)}`
        );
      }
    } catch (e) {
      console.log(`[db:cleanup-e2e] storage error for ${o.name}: ${String(e).slice(0, 90)}`);
    }
  }
  console.log(
    `[db:cleanup-e2e] removed ${removed}/${orphanObjects.length} storage object(s)`
  );
}

// Prove it rather than assuming it.
const auctionIds = fixtures.map((f) => `'${f.auction_id}'`).join(",");
const objectNames = orphanObjects
  .map((o) => `'${String(o.name).replace(/'/g, "")}'`)
  .join(",");
const check = rows(
  JSON.parse(
    await sql(`
      select
        (select count(*)::int from public.auctions
          where id in (${auctionIds || "select null::uuid where false"})) as auctions,
        (select count(*)::int from storage.objects
          where bucket_id = 'auction-images'
            and name in (${objectNames || "select null where false"})) as objects
    `)
  )
)[0];

console.log(
  `[db:cleanup-e2e] done. ${check?.auctions ?? "?"} fixture listing(s) and ${
    check?.objects ?? "?"
  } storage object(s) remain.`
);
