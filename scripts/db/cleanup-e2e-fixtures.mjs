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
 * Storage is handled in two passes, both conservative but neither heuristic-only:
 * the objects this run's own fixtures referenced are captured before their rows
 * are deleted and removed exactly, and separately a bucket sweep removes any
 * object older than an hour that no `auction_images` row references (which
 * covers rows deleted by an earlier run). An orphan is unreferenced by
 * definition, so neither pass can remove a live image.
 *
 * ORDER matters and is enforced by the foreign keys: reviews, then the payout
 * audit trail and payouts (payouts RESTRICT the transaction), then payment
 * events, then transactions, then bids, then images, then the lifecycle
 * children (cancellation requests, listing reviews and cancellation records
 * are all RESTRICT), then the auctions themselves, then the unreferenced
 * storage objects.
 *
 * Run:  node scripts/db/cleanup-e2e-fixtures.mjs --yes
 */
import { loadLocalEnv, requireEnv, projectRef } from "./load-env.mjs";

loadLocalEnv();
const TOKEN = requireEnv("SUPABASE_ACCESS_TOKEN");
const REF = projectRef() ?? requireEnv("SUPABASE_PROJECT_REF");

const dryRun = !process.argv.includes("--yes");

/** Exactly the prefixes `e2e/*.spec.ts` pass to `createListing()`. */
const PREFIXES = ["Race", "Countdown", "Loop", "Outbid", "RLS", "Relist", "Moderation", "Lifecycle", "E2E listing"];

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

/**
 * Storage objects in the auction-images bucket that nothing references.
 *
 * Two independent tests, because "old enough" alone is not enough and is not
 * necessary either:
 *
 *   1. older than an hour, which covers a row deleted by an earlier run - the
 *      margin protects an upload whose row has not been written yet; or
 *   2. the auction named in the first path segment does not exist at all, which
 *      can never be in flight no matter how new it is.
 *
 * The join is on the bare object name: `auction_images.storage_path` is the key
 * INSIDE the bucket, so the bucket is implicit and must not be prefixed on. An
 * earlier version compared `storage_path` to `bucket_id || '/' || name`, which
 * never matched - so orphans accumulated in silence while the script reported
 * that everything was already clean.
 *
 * TWO buckets, each with its own reference table: `auction-images` is
 * referenced by `auction_images.storage_path`, `avatars` by
 * `profiles.avatar_path`. Both use the one-hour grace, and for avatars that
 * grace is essential rather than decorative - an avatar upload writes the
 * object first and the profile row second, so a fresh object legitimately has
 * nothing pointing at it for a moment. A sweep without the grace would delete
 * the picture out from under a user who had just uploaded it.
 */
const orphanObjects = rows(
  JSON.parse(
    await sql(`
      select o.bucket_id, o.name, o.created_at
        from storage.objects o
       where o.bucket_id = 'auction-images'
         and not exists (
           select 1 from public.auction_images i
            where i.storage_path = o.name
         )
         and (
              o.created_at < now() - interval '1 hour'
              or not exists (
                select 1 from public.auctions a
                 where a.id::text = split_part(o.name, '/', 1)
                   and split_part(o.name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
              )
         )
      union all
      select o.bucket_id, o.name, o.created_at
        from storage.objects o
       where o.bucket_id = 'avatars'
         and not exists (
           select 1 from public.profiles p
            where p.avatar_path = o.name
         )
         and o.created_at < now() - interval '1 hour'
      order by created_at
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

// The storage keys this run's own fixtures referenced, captured BEFORE the rows
// are deleted. `auction_images.storage_path` IS the object key inside the
// bucket (the bucket is implicit, which is why it must not be split off the
// front - an earlier version of this script did that and silently deleted
// nothing). Deleting these exactly is deterministic; the time-gated orphan
// sweep above is only a safety net for objects whose row was already gone.
const fixturePaths = fixtures.length
  ? rows(
      JSON.parse(
        await sql(
          `select distinct i.storage_path
             from public.auction_images i
            where i.auction_id in (${fixtures.map((f) => `'${f.auction_id}'`).join(",")})`
        )
      )
    ).map((r) => r.storage_path)
  : [];

// Every target carries its BUCKET, not just its name. Two buckets exist, and a
// delete that guessed the bucket would either miss real objects or 404 on the
// wrong ones while reporting success.
const targets = [
  ...new Map(
    [
      ...fixturePaths.map((p) => `auction-images/${p}`),
      ...orphanObjects.map((o) => `${o.bucket_id}/${o.name}`),
    ].map((k) => {
      const at = k.indexOf("/");
      return [k, { bucket: k.slice(0, at), name: k.slice(at + 1) }];
    })
  ).values(),
];

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
      // Reports point at targets by bare uuid (no FK), so they survive the
      // auction delete and would linger as orphans pointing nowhere. Scoped
      // to fixture ids, like everything else here.
      "reports",
      `delete from public.reports where target_type = 'auction' and target_id in (${ids})`,
    ],
    [
      "notifications",
      `delete from public.notifications where auction_id in (${ids})`,
    ],
    [
      // Enqueued mail is never sent in tests (no provider key), but the rows
      // are still synthetic: anything addressed to a QA account goes with the
      // fixtures. Scoped to the QA test domain; real addresses cannot match.
      "queued email",
      `delete from public.email_outbox where recipient like '%@bidblitz.test'`,
    ],
    [
      // The preferences spec saves a real settings row as a QA user. It is
      // test-owned like everything else here, so the sweep removes QA rows;
      // a real user's row can never match the domain filter.
      "notification preferences",
      `delete from public.notification_preferences where user_id in (select id from auth.users where email like '%@bidblitz.test')`,
    ],
    [
      "auction images",
      `delete from public.auction_images where auction_id in (${ids})`,
    ],
    [
      // Lifecycle children are RESTRICT by design (a review/request row must
      // not vanish with the auction it decides), so they go before the
      // auctions themselves. Scoped to the same fixture ids.
      "cancellation requests",
      `delete from public.auction_cancellation_requests where auction_id in (${ids})`,
    ],
    [
      "listing reviews",
      `delete from public.listing_reviews where auction_id in (${ids})`,
    ],
    [
      "cancellation records",
      `delete from public.auction_cancellations where auction_id in (${ids})`,
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
if (targets.length > 0) {
  const pub = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SECRET_KEY");
  let removed = 0;
  for (const t of targets) {
    const encoded = t.name.split("/").map(encodeURIComponent).join("/");
    const url = `${pub}/storage/v1/object/${t.bucket}/${encoded}`;
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
          `[db:cleanup-e2e] storage ${res.status} for ${t.bucket}/${t.name} - ${body.slice(0, 120)}`
        );
      }
    } catch (e) {
      console.log(
        `[db:cleanup-e2e] storage error for ${t.bucket}/${t.name}: ${String(e).slice(0, 90)}`
      );
    }
  }
  console.log(`[db:cleanup-e2e] removed ${removed}/${targets.length} storage object(s)`);
}

// Prove it rather than assuming it, across BOTH buckets.
const auctionIds = fixtures.map((f) => `'${f.auction_id}'`).join(",");
const objectNames = targets
  .map((t) => `'${t.bucket}/${String(t.name).replace(/'/g, "")}'`)
  .join(",");
const check = rows(
  JSON.parse(
    await sql(`
      select
        (select count(*)::int from public.auctions
          where id in (${auctionIds || "select null::uuid where false"})) as auctions,
        (select count(*)::int from storage.objects
          where bucket_id || '/' || name in (${objectNames || "select null where false"})
        ) as objects
    `)
  )
)[0];

console.log(
  `[db:cleanup-e2e] done. ${check?.auctions ?? "?"} fixture listing(s) and ${
    check?.objects ?? "?"
  } storage object(s) remain.`
);
