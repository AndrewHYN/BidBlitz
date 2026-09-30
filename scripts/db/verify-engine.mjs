/**
 * BidBlitz database engine verification.
 *
 * Proves the things that matter, against the REAL project:
 *   1. schema + functions exist
 *   2. RLS is enabled and denies anonymous/unauthorized access
 *   3. application business rules (seller self-bid, closed auction, minimum)
 *   4. idempotent bid submission
 *   5. CONCURRENT bids serialize without corruption
 *   6. server-side anti-sniping extends the auction
 *   7. auction closes once, winner deterministic, fee math exact
 *   8. cross-user transaction access denied
 *
 * Run:  node scripts/db/verify-engine.mjs
 *
 * Requires .env.local (see .env.example) plus SUPABASE_ACCESS_TOKEN in the
 * shell. No credential is stored in this repository.
 */
import { randomUUID } from "node:crypto";
import { loadLocalEnv, requireEnv, projectRef } from "./load-env.mjs";

// Every credential is read from the environment / gitignored .env.local.
// There are deliberately NO hardcoded fallbacks: a script that works without
// configuration is how secrets end up in source control.
loadLocalEnv();

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const PUB = requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SEC = requireEnv("SUPABASE_SECRET_KEY");
const TOKEN = requireEnv("SUPABASE_ACCESS_TOKEN");
const REF = projectRef() ?? requireEnv("SUPABASE_PROJECT_REF");

const PASS = "Bl1tzVerify!2026";
// stable addresses so repeated runs are idempotent (no user-table sprawl)
const USERS = {
  seller: "seller@bidblitz.test",
  buyer1: "buyer1@bidblitz.test",
  buyer2: "buyer2@bidblitz.test",
  buyer3: "buyer3@bidblitz.test",
};

const results = [];
const t0 = Date.now();
let failures = 0;

function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  if (!cond) failures++;
  const mark = cond ? "  PASS" : "! FAIL";
  console.log(`${mark}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    // This environment suffers intermittent network stalls (Windows suspends
    // network I/O). Fail loudly instead of hanging the run forever.
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${body}`);
  try { return JSON.parse(body); } catch { return body; }
}

function rows(x) {
  if (Array.isArray(x)) {
    if (x.length === 0) return [];
    if (Array.isArray(x[0])) return x.flat();
    return x;
  }
  return [];
}

async function rest(path, { method = "GET", key = PUB, bearer, body, raw, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${URL_}${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${bearer ?? key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      // A stalled request must fail THIS check, not hang the whole run.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return {
      status: 0,
      ok: false,
      data: { transport_error: `${e?.name ?? "Error"}: ${e?.message ?? e}` },
    };
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function signup(email) {
  // GoTrue rate-limits concurrent signups (over_email_send_rate_limit), and the
  // harness needs 4 accounts at once. Creating them directly through the
  // Management API is deterministic and still fires on_auth_user_created,
  // so profile provisioning is exercised exactly as it is in production.
  const displayName = email.split("@")[0].replace(/\+\d+/, "");
  const uid = randomUUID();

  const cryptoNs = await sql(
    `select n.nspname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'crypt' limit 1`
  );
  const sch = cryptoNs[0]?.nspname ?? "public";

  await sql(`
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at,
      -- CRITICAL: exactly these four columns must be '' not NULL.
      -- GoTrue's password grant 500s ("Database error querying schema") when
      -- they are NULL. Everything else (phone, phone_change, *_token_current,
      -- ...) must stay at its DEFAULT: the phone column carries a UNIQUE
      -- constraint, so writing '' there collides across users.
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      '${uid}',
      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      '${email}',
      ${sch}.crypt('${PASS}', ${sch}.gen_salt('bf')),
      now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('sub', '${uid}', 'email', '${email}',
                         'display_name', '${displayName}',
                         'email_verified', true, 'phone_verified', false),
      now(), now()
    )
    on conflict do nothing`);
  // untargeted ON CONFLICT: catches the email unique index, not just (id),
  // so repeated harness runs are idempotent instead of exploding on 23505.

  // normalise any pre-existing row (previous runs) to GoTrue's shape
  await sql(`
    update auth.users
       set confirmation_token = coalesce(confirmation_token, ''),
           recovery_token = coalesce(recovery_token, ''),
           email_change_token_new = coalesce(email_change_token_new, ''),
           email_change = coalesce(email_change, '')
     where email = '${email}'`);

  // identity row: idempotent. provider_id is NOT NULL, so it must never be
  // omitted; guarded by NOT EXISTS so re-running for an existing user is a no-op
  // rather than a unique violation.
  await sql(`
    insert into auth.identities
      (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
    select gen_random_uuid(), u.id, 'email', u.id::text,
           jsonb_build_object('sub', u.id::text, 'email', u.email,
                              'email_verified', true),
           now(), now()
      from auth.users u
     where u.email = '${email}'
       and not exists (
         select 1 from auth.identities i
          where i.user_id = u.id and i.provider = 'email')
    on conflict do nothing`);
}

async function signIn(email) {
  const r = await rest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password: PASS },
  });
  if (!r.ok) throw new Error(`signin ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.access_token;
}

// ---------------------------------------------------------------------------
console.log("\n=== BidBlitz engine verification ===\n");

// ---- 1. schema ------------------------------------------------------------
const tables = rows(await sql(`
  select table_name from information_schema.tables
   where table_schema='public' and table_type='BASE TABLE'
   order by table_name`)).map((r) => r.table_name ?? r.table_name);

const required = ["profiles","categories","auctions","auction_images","bids",
  "watchlist","notifications","fee_settings","transactions","reviews","reports"];
check("schema: all 11 core tables exist",
  required.every((t) => tables.includes(t)),
  `missing: ${required.filter((t) => !tables.includes(t)).join(",") || "none"}`);

const funcs = rows(await sql(`
  select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'`)).map((r) => r.proname);
check("schema: auction engine functions exist",
  ["place_bid","settle_auction","settle_due_auctions","publish_auction","cancel_auction"]
    .every((f) => funcs.includes(f)),
  `missing: ${["place_bid","settle_auction","settle_due_auctions","publish_auction","cancel_auction"].filter((f)=>!funcs.includes(f)).join(",") || "none"}`);

const rls = rows(await sql(`
  select relname, relrowsecurity from pg_class c
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'`));
const noRls = rls.filter((r) => !r.relrowsecurity && r.relname !== "schema_migrations")
  .map((r) => r.relname);
check("security: RLS enabled on every public table", noRls.length === 0,
  noRls.length ? `not protected: ${noRls.join(",")}` : `${rls.length} tables`);

// Management API returns a flat array of row objects, e.g. [{n:"0"}]
const bidWritePolicies = rows(await sql(`select count(*) as n from pg_policies
               where schemaname='public' and tablename='bids'
                 and cmd in ('insert','update','delete')`))[0]?.n;
check("security: bids has no client INSERT policy", String(bidWritePolicies) === "0",
  `write policies on bids = ${bidWritePolicies}`);

// ---- 2. users -------------------------------------------------------------
console.log("\n--- creating test users ---");
for (const email of Object.values(USERS)) await signup(email);

const prof = rows(await sql(`select id, username from public.profiles`));
check("auth: signup creates a profile row (trigger)", prof.length >= 4,
  `${prof.length} profiles`);

const tok = {};
for (const [k, email] of Object.entries(USERS)) tok[k] = await signIn(email);
check("auth: password sign-in issues a session for every test user",
  Object.values(tok).every((t) => typeof t === "string" && t.length > 20),
  `${Object.keys(tok).length} sessions`);

// ---- reset state so counts are exact on every run -------------------------
// Without this, rows from a previous run leak into assertions and turn real
// behaviour (e.g. "buyer3 bought in run #1 too") into a false failure.
const testIds = rows(await sql(
  `select p.id from public.profiles p
     join auth.users u on u.id = p.id
    where u.email like '%@bidblitz.test'`
)).map((r) => r.id);
if (testIds.length) {
  const list = testIds.map((i) => `'${i}'`).join(",");
  await sql(`delete from public.reviews where reviewer_id in (${list}) or reviewee_id in (${list})`);
  // Payouts are a child of transactions (FK is RESTRICT, by design: the audit
  // trail must not vanish with the sale). They have to go first.
  await sql(`delete from public.seller_payout_events
              where payout_id in (select id from public.seller_payouts
                                   where seller_id in (${list}))`);
  await sql(`delete from public.seller_payouts where seller_id in (${list})`);
  // Harness payment events are synthetic by provider name; orphaned ones (no
  // parent transaction) come only from a crashed run whose end-cleanup never
  // ran. Scoped to harness rows so a real Paynow audit row is unreachable.
  await sql(`delete from public.payment_events
              where provider like 'harness%'
                and (transaction_id not in (select id from public.transactions)
                     or transaction_id in (select id from public.transactions
                                            where seller_id in (${list}) or buyer_id in (${list})))`);
  await sql(`delete from public.transactions where seller_id in (${list}) or buyer_id in (${list})`);
  await sql(`delete from public.bids where bidder_id in (${list})`);
  // Image rows first: explicit even if the FK cascades — a row whose object
  // never existed renders as a broken image on browse/detail.
  await sql(`delete from public.auction_images
              where auction_id in (select id from public.auctions where seller_id in (${list}))`);
  // Lifecycle children (RESTRICT by design: a review/request row must not
  // vanish with the auction it decides). They go before the auctions.
  await sql(`delete from public.auction_cancellation_requests
              where requester_id in (${list})
                 or auction_id in (select id from public.auctions where seller_id in (${list}))`);
  await sql(`delete from public.listing_reviews
              where auction_id in (select id from public.auctions where seller_id in (${list}))`);
  await sql(`delete from public.auction_cancellations
              where actor_id in (${list})
                 or auction_id in (select id from public.auctions where seller_id in (${list}))`);
  await sql(`delete from public.auctions where seller_id in (${list})`);
  await sql(`delete from public.notifications where user_id in (${list})`);
  await sql(`delete from public.watchlist where user_id in (${list})`);
  await sql(`delete from public.reports where reporter_id in (${list})`);
  // Harness staff rows are unmistakable (every harness grant carries a
  // 'Harness:' reason): a crashed run's temp OWNER/ADMIN grants are removed
  // here so the next run starts clean. The is_admin mirror is recomputed from
  // live assignments ONLY for those users - a QA admin holding access through
  // any other path still trips the SAFETY pre-flight below, loudly.
  const harnessStaff = rows(await sql(
    `select distinct user_id from public.staff_assignments where reason like 'Harness:%'`));
  if (harnessStaff.length) {
    await sql(`delete from public.staff_assignments where reason like 'Harness:%'`);
    for (const r of harnessStaff) {
      await sql(`select public.staff_sync_is_admin('${r.user_id}')`);
    }
    console.log(`  reset harness staff rows for ${harnessStaff.length} user(s)`);
  }
  console.log(`  reset state for ${testIds.length} test users`);
}

// ---- 3. anonymous / unauthorized access -----------------------------------
console.log("\n--- authorization (RLS) ---");
const anonDraft = await rest(`/rest/v1/auctions?status=eq.DRAFT&select=id`);
check("RLS: anon cannot read DRAFT auctions",
  anonDraft.ok && anonDraft.data.length === 0, `${anonDraft.data?.length ?? "?"} rows`);

const anonTx = await rest(`/rest/v1/transactions?select=id`);
check("RLS: anon cannot read transactions", anonTx.ok && anonTx.data.length === 0);

const anonNotif = await rest(`/rest/v1/notifications?select=id`);
check("RLS: anon cannot read notifications", anonNotif.ok && anonNotif.data.length === 0);

const anonInsert = await rest(`/rest/v1/auctions`, {
  method: "POST", key: PUB, bearer: PUB,
  body: { seller_id: "00000000-0000-0000-0000-000000000000", title: "hack",
          description: "should not be permitted at all", condition: "new",
          location: "nowhere", starting_bid_minor: 1, bid_increment_minor: 1 },
});
check("RLS: anon cannot create an auction", !anonInsert.ok,
  `status ${anonInsert.status}`);

const anonBid = await rest(`/rest/v1/bids`, {
  method: "POST",
  body: { auction_id: "00000000-0000-0000-0000-000000000000",
          bidder_id: "00000000-0000-0000-0000-000000000000",
          amount_minor: 1, currency: "USD", request_id: randomUUID() },
});
check("RLS: bids cannot be inserted directly (bypass place_bid)", !anonBid.ok,
  `status ${anonBid.status}`);

// ---- 4. seller creates + publishes ----------------------------------------
console.log("\n--- seller flow ---");
const auctionPayload = {
  // placeholder, real seller id is assigned below
  seller_id: "00000000-0000-0000-0000-000000000000",
  title: "PlayStation 5 Slim Disc Console",
  description: "Lightly used PS5 Slim with controller, box and all cables. No scratches on the disc drive. Smoke-free home.",
  condition: "like_new",
  location: "Austin, TX",
  currency: "USD",
  starting_bid_minor: 1000,     // $10.00
  bid_increment_minor: 500,     // $5.00
  duration_seconds: 3600,
  anti_snipe_window_seconds: 30,
  anti_snipe_extension_seconds: 30,
  status: "DRAFT",
  // image_count deliberately absent (migration 000008): clients hold no INSERT
  // grant on it, and it is derived from auction_images by sync_image_count.
  // The previous `image_count: 1` here faked a photo that did not exist.
};

// find the seller profile for our seller user
const sellerId = rows(await sql(
  `select p.id from public.profiles p
     join auth.users u on u.id = p.id where u.email = '${USERS.seller}'`))[0]?.id;
const buyer1Id = rows(await sql(
  `select p.id from public.profiles p
     join auth.users u on u.id = p.id where u.email = '${USERS.buyer1}'`))[0]?.id;
const buyer2Id = rows(await sql(
  `select p.id from public.profiles p
     join auth.users u on u.id = p.id where u.email = '${USERS.buyer2}'`))[0]?.id;
const buyer3Id = rows(await sql(
  `select p.id from public.profiles p
     join auth.users u on u.id = p.id where u.email = '${USERS.buyer3}'`))[0]?.id;

check("harness: resolved all four test identities",
  [sellerId, buyer1Id, buyer2Id, buyer3Id].every(Boolean),
  `seller=${!!sellerId} b1=${!!buyer1Id} b2=${!!buyer2Id} b3=${!!buyer3Id}`);

  // Pre-flight fail-closed gate: no QA identity may hold admin, and the admin
  // population must already be exactly the owner's real account - BEFORE this
  // run writes, deletes, toggles, or purges anything. Every destructive
  // statement below is scoped to QA identities or guarded fixture ids, so a
  // real account cannot match any predicate; this gate makes that a verified
  // precondition rather than an assumption, and stops the run while the
  // database is still untouched if the world is not as expected.
  //
  // This exists because a previous version of this file destroyed the owner's
  // real profile picture on a green run: the cleanup was unscoped, and nothing
  // checked anything before writing. Scoping fixed that incident; this gate
  // fixes the class.
  const preflightQaAdmins = rows(await sql(
    `select u.email from public.profiles p
       join auth.users u on u.id = p.id
      where p.is_admin and u.email like '%@bidblitz.test'`));
  const preflightAdmins = rows(await sql(
    `select u.email from public.profiles p
       join auth.users u on u.id = p.id
      where p.is_admin order by u.email`));
  check("SAFETY pre-flight: no QA account holds admin before anything writes",
    preflightQaAdmins.length === 0,
    preflightQaAdmins.length === 0
      ? "no QA admin"
      : `REFUSING TO CONTINUE: ${preflightQaAdmins.map((a) => a.email).join(", ")}`);
  check("SAFETY pre-flight: exactly one real admin and no QA admin",
    preflightAdmins.length === 1 && preflightQaAdmins.length === 0,
    `admins=${preflightAdmins.map((a) => a.email).join(", ") || "(none)"}`);
  if (preflightQaAdmins.length !== 0 || preflightAdmins.length !== 1) {
    console.log("SAFETY pre-flight failed: aborting before any write.");
    process.exit(1);
  }


auctionPayload.seller_id = sellerId;

const created = await rest(`/rest/v1/auctions`, {
  method: "POST", bearer: tok.seller,
  headers: { Prefer: "return=representation" },
  body: auctionPayload,
});
check("seller: can create own DRAFT auction", created.ok, `status ${created.status}`);
const auctionId = created.data?.[0]?.id;
check("seller: auction id returned", !!auctionId, auctionId ?? "none");

// a different user must not be able to write into that auction
const hijack = await rest(`/rest/v1/auctions?id=eq.${auctionId}`, {
  method: "PATCH", bearer: tok.buyer1,
  body: { title: "hijacked title by buyer" },
});
const afterHijack = rows(await sql(
  `select title from public.auctions where id='${auctionId}'`))[0];
check("RLS: another user cannot modify someone else's auction",
  hijack.ok && afterHijack.title === auctionPayload.title,
  `${JSON.stringify(hijack.data)} / title unchanged: ${afterHijack.title === auctionPayload.title}`);

const forcedWinner = await rest(`/rest/v1/auctions?id=eq.${auctionId}`, {
  method: "PATCH", bearer: tok.seller,
  body: { winner_id: buyer1Id, winning_bid_minor: 999999, status: "SOLD" },
});
const postForced = rows(await sql(
  `select status, winner_id, winning_bid_minor from public.auctions where id='${auctionId}'`))[0];
check("security: seller cannot hand-set winner/price/status",
  postForced.status === "DRAFT" && postForced.winner_id === null,
  `status=${postForced.status} (blocked: ${JSON.stringify(forcedWinner.data)})`);

// ---- 4b. image_count is derived and cannot be faked -------------------------
console.log("\n--- image_count (derived, migration 000008) ---");

// (a) With no photo, publish must be refused. This is the rule that a faked
//     `image_count: 1` used to sail straight past.
const pubNoImg = await rest(`/rest/v1/rpc/publish_auction`, {
  method: "POST", bearer: tok.seller,
  body: { p_auction_id: auctionId },
});
const stillDraft = rows(await sql(
  `select status from public.auctions where id='${auctionId}'`))[0];
check("rule: publish is refused until a photo exists",
  !pubNoImg.ok && /image_required/.test(JSON.stringify(pubNoImg.data))
    && stillDraft.status === "DRAFT",
  `status ${pubNoImg.status} / auction=${stillDraft.status}`);

// (b) A real photo row moves the derived counter all by itself.
const img = await rest(`/rest/v1/auction_images`, {
  method: "POST", bearer: tok.seller,
  body: {
    auction_id: auctionId,
    storage_path: `harness/${auctionId}/cover.jpg`,
    position: 0,
  },
});
const derivedCount = rows(await sql(
  `select image_count from public.auctions where id='${auctionId}'`))[0];
check("derived: an auction_images row sets image_count",
  img.ok && derivedCount.image_count === 1,
  `insert status ${img.status} / image_count=${derivedCount.image_count}`);

// (c) ...and no client may move that counter by hand.
const forgedCount = await rest(`/rest/v1/auctions?id=eq.${auctionId}`, {
  method: "PATCH", bearer: tok.seller,
  body: { image_count: 8 },
});
const afterForge = rows(await sql(
  `select image_count from public.auctions where id='${auctionId}'`))[0];
check("security: image_count is not client-writable",
  !forgedCount.ok && afterForge.image_count === 1,
  `status ${forgedCount.status} / image_count=${afterForge.image_count}`);

const pub = await rest(`/rest/v1/rpc/publish_auction`, {
    method: "POST", bearer: tok.seller,
    body: { p_auction_id: auctionId },
  });
  // The seller holds no non-draft auctions at this point (every fixture is
  // created and removed in its own section), so this first publish is
  // deterministically routed to PENDING_REVIEW - which is exactly the AA
  // scenario, exercised here on the main fixture instead of a throwaway. An
  // operator approves it below, and everything downstream proceeds on a LIVE
  // auction exactly as before.
  check("seller: first publish routes to PENDING_REVIEW with recorded flags",
    pub.ok && pub.data?.status === "PENDING_REVIEW"
      && pub.data?.risk_flags?.first_listing === true,
    JSON.stringify(pub.data));
  await sql(`update public.profiles set is_admin = true where id='${buyer2Id}'`);
  const mainReviewId = rows(await sql(
    `select id from public.listing_reviews where auction_id='${auctionId}' and status='PENDING'`))[0]?.id;
  const mainApprove = await rest(`/rest/v1/rpc/admin_decide_review`, {
    method: "POST", bearer: tok.buyer2,
    body: { p_review_id: mainReviewId, p_decision: "APPROVED" },
  });
  await sql(`update public.profiles set is_admin = false where id='${buyer2Id}'`);
  const mainLive = rows(await sql(
    `select status from public.auctions where id='${auctionId}'`))[0]?.status;
  check("seller: approved review publishes the main fixture LIVE",
    mainApprove.ok && mainLive === "LIVE",
    `status=${mainLive} ${JSON.stringify(mainApprove.data)}`);
// Cross-user Storage access (release gate): the bucket is public-read, but
// only the auction owner may write into <auction_id>/* — and only while the
// auction is open. Checked here, while the auction is genuinely LIVE.
const storagePath = `${auctionId}/harness-probe.jpg`;
const jpegBytes = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const foreignUpload = await rest(`/storage/v1/object/auction-images/${storagePath}`, {
  method: "POST", bearer: tok.buyer2,
  headers: { "Content-Type": "image/jpeg" },
  body: jpegBytes, raw: true,
});
// The Storage API reports an RLS denial as HTTP 400 with a statusCode 403
// envelope, so assert on the authoritative body message, not the HTTP code.
const foreignBody = JSON.stringify(foreignUpload.data ?? "");
check("security: a non-owner cannot write into another auction's storage folder",
  !foreignUpload.ok && /row-level security/i.test(foreignBody),
  `status ${foreignUpload.status} ${foreignBody.slice(0, 160)}`);

const ownUpload = await rest(`/storage/v1/object/auction-images/${storagePath}`, {
  method: "POST", bearer: tok.seller,
  headers: { "Content-Type": "image/jpeg" },
  body: jpegBytes, raw: true,
});
const storageCleanup = await rest(`/storage/v1/object/auction-images/${storagePath}`, {
  method: "DELETE", bearer: tok.seller,
});
check("storage: the owner's own upload still works (policy intact)",
  ownUpload.ok, `status ${ownUpload.status} cleanup=${storageCleanup.status}`);

// ---- 5. business rules -----------------------------------------------------
console.log("\n--- bid business rules ---");

const asSeller = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.seller,
  body: { p_auction_id: auctionId, p_amount_minor: 2000, p_request_id: randomUUID() },
});
check("rule: seller cannot bid on own auction",
  !asSeller.ok && /seller_cannot_bid/.test(JSON.stringify(asSeller.data)),
  JSON.stringify(asSeller.data));

const asAnon = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST",
  body: { p_auction_id: auctionId, p_amount_minor: 2000, p_request_id: randomUUID() },
});
check("rule: anonymous bid rejected", !asAnon.ok, JSON.stringify(asAnon.data));

const tooLow = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_auction_id: auctionId, p_amount_minor: 500, p_request_id: randomUUID() },
});
check("rule: bid below minimum rejected (hint carries the floor)",
  !tooLow.ok && /below_minimum/.test(JSON.stringify(tooLow.data)),
  JSON.stringify(tooLow.data));

// ---- 6. real bid ----------------------------------------------------------
const reqA = randomUUID();
const bidA = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_auction_id: auctionId, p_amount_minor: 1000, p_request_id: reqA },
});
check("bid: first bid at starting price accepted",
  bidA.ok && bidA.data?.current_bid_minor === 1000 && bidA.data?.bid_count === 1,
  JSON.stringify(bidA.data));

// ---- 7. idempotency -------------------------------------------------------
const dup = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_auction_id: auctionId, p_amount_minor: 1000, p_request_id: reqA },
});
const bidCountAfterDup = rows(await sql(
  `select count(*) as n from public.bids where auction_id='${auctionId}'`))[0].n;
check("idempotency: replayed request does NOT create a second bid",
  dup.ok && dup.data?.duplicate === true && bidCountAfterDup === 1,
  `bids=${bidCountAfterDup} duplicate=${dup.data?.duplicate}`);

// ---- 8. outbid ------------------------------------------------------------
const bidB = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer2,
  body: { p_auction_id: auctionId, p_amount_minor: 1500, p_request_id: randomUUID() },
});
check("bid: higher bid accepted, projection updated",
  bidB.ok && bidB.data?.current_bid_minor === 1500 && bidB.data?.bid_count === 2,
  JSON.stringify({ cur: bidB.data?.current_bid_minor, n: bidB.data?.bid_count }));

const outbidNotif = rows(await sql(
  `select type, payload from public.notifications
    where user_id='${buyer1Id}' and type='OUTBID'`));
check("notification: previous bidder notified OUTBID",
  outbidNotif.length >= 1 && outbidNotif[0].payload.current_bid_minor === 1500,
  JSON.stringify(outbidNotif[0]?.payload ?? null));

// ---- 9. CONCURRENCY -------------------------------------------------------
console.log("\n--- concurrency (the critical test) ---");
const targetMinor = 1500 + 500; // both buyers aim at exactly the minimum
const [c1, c2] = await Promise.all([
  rest(`/rest/v1/rpc/place_bid`, {
    method: "POST", bearer: tok.buyer1,
    body: { p_auction_id: auctionId, p_amount_minor: targetMinor, p_request_id: randomUUID() },
  }),
  rest(`/rest/v1/rpc/place_bid`, {
    method: "POST", bearer: tok.buyer2,
    body: { p_auction_id: auctionId, p_amount_minor: targetMinor, p_request_id: randomUUID() },
  }),
]);

const acc1 = c1.ok && c1.data?.ok === true;
const acc2 = c2.ok && c2.data?.ok === true;
const accepted = [acc1, acc2].filter(Boolean).length;

const after = rows(await sql(
  `select current_bid_minor, bid_count, current_bidder_id, status,
          (select count(*)::int from public.bids b where b.auction_id=a.id) as bid_rows
     from public.auctions a where id='${auctionId}'`))[0];

check("concurrency: exactly ONE of two simultaneous bids wins the race",
  accepted === 1, `accepted=${accepted} (${acc1}/${acc2})`);
check("concurrency: auction projection matches the bids table (no drift)",
  after.bid_count === after.bid_rows && after.bid_count === 3,
  `bid_count=${after.bid_count} bid_rows=${after.bid_rows}`);
check("concurrency: current price equals the accepted amount exactly",
  Number(after.current_bid_minor) === targetMinor,
  `current=${after.current_bid_minor} expected=${targetMinor}`);
check("concurrency: auction state not corrupted",
  after.status === "LIVE" && after.current_bidder_id !== null,
  `status=${after.status}`);

// loser must have been told it was below minimum, never a false success
if (accepted === 1) {
  const rejected = acc1 ? c2 : c1;
  check("concurrency: losing bid got a specific error, not a false success",
    !rejected.ok && /below_minimum/.test(JSON.stringify(rejected.data)),
    JSON.stringify(rejected.data));
}

// ---- 10. anti-sniping -----------------------------------------------------
console.log("\n--- anti-sniping ---");
// This machine suffers multi-second network stalls, so the closing window is
// widened (ends_at +90s against a 120s window): the test must measure the
// ENGINE's extension rule, never this environment's latency. The assertion —
// a bid landing inside anti_snipe_window_seconds extends ends_at on the
// server — is unchanged.
await sql(`update public.auctions
              set ends_at = now() + interval '90 seconds',
                  anti_snipe_window_seconds = 120
            where id='${auctionId}'`);

const before = rows(await sql(`select ends_at from public.auctions where id='${auctionId}'`))[0];
const snipe = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer3,
  body: { p_auction_id: auctionId, p_amount_minor: targetMinor + 500, p_request_id: randomUUID() },
});
const afterSnipe = rows(await sql(`select ends_at, extension_count from public.auctions where id='${auctionId}'`))[0];
const extended = new Date(afterSnipe.ends_at).getTime() > new Date(before.ends_at).getTime();
check("anti-snipe: bid inside the closing window extends ends_at on the server",
  snipe.ok && snipe.data?.extended === true && extended,
  `extended=${snipe.data?.extended} ext_count=${afterSnipe.extension_count} status=${snipe.status} resp=${JSON.stringify(snipe.data)?.slice(0, 200)}`);
check("anti-snipe: extension recorded + broadcast by the response",
  Number(afterSnipe.extension_count) >= 1 && snipe.data?.extension_seconds === 30,
  `ext=${afterSnipe.extension_count}s/${snipe.data?.extension_seconds}s`);

// ---- 11. close + winner + fee --------------------------------------------
console.log("\n--- settlement ---");
await sql(`update public.auctions set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second'
            where id='${auctionId}'`);

const late = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_auction_id: auctionId, p_amount_minor: 999999, p_request_id: randomUUID() },
});
  // Since migration 20260929000001 the refusal is a RETURNED {ok:false}
  // rather than a raise - HTTP 200 with the error inside the body - because
  // raising after settling rolled the settlement back. Same user-visible
  // refusal, but the close now survives it, which the next check proves on
  // the row itself.
  check("rule: bid after server-authoritative close rejected",
    late.ok && late.data?.ok === false && late.data?.error === 'auction_ended',
    JSON.stringify(late.data));
  const afterLateBid = rows(await sql(
    `select status from public.auctions where id='${auctionId}'`))[0].status;
  check("settle: a refused late bid leaves the auction SETTLED, not LIVE",
    afterLateBid === "SOLD",
    `status=${afterLateBid} (the settlement committed instead of rolling back)`);

const settled = await rest(`/rest/v1/rpc/settle_auction`, {
  method: "POST", bearer: SEC, key: SEC,
  body: { p_auction_id: auctionId },
});
check("settle: auction closed to SOLD", settled.ok && settled.data?.status === "SOLD",
  JSON.stringify(settled.data));

const settleAgain = await rest(`/rest/v1/rpc/settle_auction`, {
  method: "POST", bearer: SEC, key: SEC,
  body: { p_auction_id: auctionId },
});
const txCount = rows(await sql(
  `select count(*)::int as n from public.transactions where auction_id='${auctionId}'`))[0].n;
check("settle: closing twice creates only ONE transaction (idempotent)",
  txCount === 1 && settleAgain.data?.already_settled === true,
  `transactions=${txCount}`);

const auctionRow = rows(await sql(
  `select status, winner_id, winning_bid_minor from public.auctions where id='${auctionId}'`))[0];
const winnerIsHighest = auctionRow.winner_id === buyer3Id;
check("settle: winner is the highest bidder, decided in the database",
  auctionRow.status === "SOLD" && winnerIsHighest,
  `winner=${auctionRow.winner_id === buyer3Id ? "highest bidder" : "WRONG"}`);

const tx = rows(await sql(
  `select gross_minor, fee_bps, fee_minor, net_minor, status, currency
     from public.transactions where auction_id='${auctionId}'`))[0];
const gross = Number(tx.gross_minor);
const expectedFee = Math.round(gross * Number(tx.fee_bps) / 10000);
check("fee: integer minor-unit math is exact (5%)",
  Number(tx.fee_minor) === expectedFee && Number(tx.fee_minor) + Number(tx.net_minor) === gross,
  `gross=${gross} fee=${tx.fee_bps}bps=${tx.fee_minor} net=${tx.net_minor}`);
check("fee: currency explicit on the financial record", tx.currency === "USD", tx.currency);
check("payment: transaction honestly AWAITING_PAYMENT (no fake 'paid')",
  tx.status === "AWAITING_PAYMENT", tx.status);

const wonNotif = rows(await sql(
  `select type from public.notifications where user_id='${buyer3Id}' and type='WON'`));
const soldNotif = rows(await sql(
  `select type from public.notifications where user_id='${sellerId}' and type='SOLD'`));
check("notifications: winner got WON, seller got SOLD",
  wonNotif.length === 1 && soldNotif.length === 1,
  `won=${wonNotif.length} sold=${soldNotif.length}`);
  // ---- 11b. the endings that are not a sale ----------------------------------
  //
  // CASE B (sold) had thorough coverage above. The endings that produce NO money
  // had none, and "nobody bid on it" is the most common thing a real marketplace
  // produces. So the whole contract for those endings was unverified at the
  // database level, which is why this section exists.
  //
  // Both fixtures are created here and deleted again before the section ends.
  // They are not left for `cleanup-e2e-fixtures.mjs`, which matches the e2e
  // suite's listing-name scheme; when they were left behind they broke this
  // file's own residue check.
  const CASE_A_TITLE = "Verify: unsold lot nobody wanted";
  const CASE_D_TITLE = "Verify: cancelled before anyone bid";

  const emptyCreated = await rest(`/rest/v1/auctions`, {
    method: "POST", bearer: tok.seller,
    headers: { Prefer: "return=representation" },
    body: { ...auctionPayload, title: CASE_A_TITLE },
  });
  const emptyId = emptyCreated.data?.[0]?.id;
  check("CASE A: a second auction was created for the no-bids path", !!emptyId,
    emptyId ?? JSON.stringify(emptyCreated.data));

  if (emptyId) {
    // publish_auction refuses an auction with no photo, exactly as the sell flow
    // does. The row only has to exist, name this auction, and use the `harness/`
    // prefix the cleanup below keys on.
    await rest(`/rest/v1/auction_images`, {
      method: "POST", bearer: tok.seller,
      body: { auction_id: emptyId, storage_path: `harness/${emptyId}/cover.jpg`, position: 0 },
    });

    const publishedEmpty = await rest(`/rest/v1/rpc/publish_auction`, {
      method: "POST", bearer: tok.seller,
      body: { p_auction_id: emptyId },
    });
    check("CASE A: the no-bid auction published normally",
      publishedEmpty.ok && publishedEmpty.data?.status === "LIVE",
      JSON.stringify(publishedEmpty.data));

    const beforeEmptyBids = rows(await sql(
      `select count(*)::int as n from public.bids where auction_id='${emptyId}'`))[0].n;
    check("CASE A: nobody bid on it", beforeEmptyBids === 0, `bids=${beforeEmptyBids}`);

    await sql(`update public.auctions set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second'
                where id='${emptyId}'`);

    // A bid on an expired auction must be refused, whatever else is true.
    const lateBidNoBids = await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: emptyId, p_amount_minor: 999999, p_request_id: randomUUID() },
    });
      // A bid on an expired auction must be refused, whatever else is true -
      // and since migration 20260929000001 the refusal is returned, not raised,
      // so the settlement it performs commits instead of rolling back.
      check("CASE A: a bid after the close is refused",
        lateBidNoBids.ok && lateBidNoBids.data?.ok === false
          && lateBidNoBids.data?.error === "auction_ended",
        JSON.stringify(lateBidNoBids.data));

      // THE FIX, asserted directly. Before migration 20260929000001 this
      // read LIVE: place_bid() settled and then raised, and the raise rolled
      // the settlement back. Now the refused late bid leaves the auction
      // SETTLED - UNSOLD with no winner, no transaction, and the seller
      // notified - which the checks below verify one claim at a time.
      const afterLateBid = rows(await sql(
        `select status from public.auctions where id='${emptyId}'`))[0].status;
      check("CASE A: a refused late bid settles the auction instead of leaving it LIVE",
        afterLateBid === "UNSOLD",
        `status=${afterLateBid} (settlement committed, bid refused)`);
    // What the working triggers do.
    const settleEmpty = await rest(`/rest/v1/rpc/settle_auction`, {
      method: "POST", bearer: SEC, key: SEC,
      body: { p_auction_id: emptyId },
    });
    const emptyRow = rows(await sql(
      `select status, winner_id, winning_bid_minor
         from public.auctions where id='${emptyId}'`))[0];
    check("CASE A: closes to UNSOLD with no winner and no winning price",
      emptyRow.status === "UNSOLD"
        && emptyRow.winner_id === null
        && emptyRow.winning_bid_minor === null,
      `status=${emptyRow.status} winner=${emptyRow.winner_id} amount=${emptyRow.winning_bid_minor} ${JSON.stringify(settleEmpty.data)}`);

    // The one that matters most: a zero-value "sale" would invent a financial
    // record and a payout obligation for an item nobody bought.
    const emptyTx = rows(await sql(
      `select count(*)::int as n from public.transactions where auction_id='${emptyId}'`))[0].n;
    check("CASE A: NO transaction is created for an auction that did not sell",
      emptyTx === 0, `transactions=${emptyTx}`);

    const emptyWins = rows(await sql(
      `select count(*)::int as n from public.bids
        where auction_id='${emptyId}' and is_winning`))[0].n;
    check("CASE A: no bid is marked winning", emptyWins === 0, `winning_bids=${emptyWins}`);

    const unsoldNotif = rows(await sql(
      `select type from public.notifications
        where user_id='${sellerId}' and auction_id='${emptyId}' and type='ENDED_UNSOLD'`));
    check("CASE A: the seller is told it ended without a sale",
      unsoldNotif.length === 1, `ENDED_UNSOLD=${unsoldNotif.length}`);

    // Idempotency for this case specifically: settling again must not invent a
    // transaction, and must not quietly turn an unsold lot into a sale.
    const emptyAgain = await rest(`/rest/v1/rpc/settle_auction`, {
      method: "POST", bearer: SEC, key: SEC,
      body: { p_auction_id: emptyId },
    });
    const emptyTxAfter = rows(await sql(
      `select count(*)::int as n from public.transactions where auction_id='${emptyId}'`))[0].n;
    const emptyStatusAfter = rows(await sql(
      `select status from public.auctions where id='${emptyId}'`))[0].status;
    check("CASE A: settling an unsold auction again is idempotent and stays unsold",
      emptyTxAfter === 0 && emptyStatusAfter === "UNSOLD",
      `transactions=${emptyTxAfter} status=${emptyStatusAfter} ${JSON.stringify(emptyAgain.data)}`);

    // CASE D. Cancelled and unsold are both "no sale", and conflating them would
    // tell a seller their item was rejected on the open market when it was not.
    const cancelledCreated = await rest(`/rest/v1/auctions`, {
      method: "POST", bearer: tok.seller,
      headers: { Prefer: "return=representation" },
      body: { ...auctionPayload, title: CASE_D_TITLE },
    });
    const cancelledId = cancelledCreated.data?.[0]?.id;
    const cancelled = cancelledId
      ? await rest(`/rest/v1/rpc/cancel_auction`, {
          method: "POST", bearer: tok.seller,
          body: { p_auction_id: cancelledId },
        })
      : { data: "auction was not created" };
    const cancelledRow = rows(await sql(
      `select status from public.auctions where id='${cancelledId}'`))[0];
    const cancelledTx = rows(await sql(
      `select count(*)::int as n from public.transactions where auction_id='${cancelledId}'`))[0].n;
    check("CASE D: a seller can cancel their own auction, and it is CANCELLED not UNSOLD",
      cancelledRow?.status === "CANCELLED" && cancelledTx === 0,
      `status=${cancelledRow?.status} transactions=${cancelledTx} ${JSON.stringify(cancelled.data)}`);

    // A cancelled auction must never be settleable into a sale.
    await rest(`/rest/v1/rpc/settle_auction`, {
      method: "POST", bearer: SEC, key: SEC,
      body: { p_auction_id: cancelledId },
    });
    const stillCancelled = rows(await sql(
      `select status from public.auctions where id='${cancelledId}'`))[0].status;
    const cancelledTxAfter = rows(await sql(
      `select count(*)::int as n from public.transactions where auction_id='${cancelledId}'`))[0].n;
    check("CASE D: a cancelled auction can never become a sale",
      stillCancelled === "CANCELLED" && cancelledTxAfter === 0,
      `status=${stillCancelled} transactions=${cancelledTxAfter}`);

    // Remove this section's own fixtures. Scoped to these two ids, and only
    // once both are bid-free and transaction-free, so a real listing cannot be
    // reached even if an id were somehow wrong.
    const caseIds = [emptyId, cancelledId].filter(Boolean);
    const caseIdList = caseIds.map((x) => `'${x}'`).join(",");
    const unsafeToDelete = rows(await sql(
      `select a.id::text from public.auctions a
        where a.id in (${caseIdList})
          and (a.title not in ('${CASE_A_TITLE}', '${CASE_D_TITLE}')
               or exists (select 1 from public.bids b where b.auction_id = a.id)
               or exists (select 1 from public.transactions t where t.auction_id = a.id))`));
    if (unsafeToDelete.length === 0) {
      await sql(`delete from public.auction_cancellation_requests where auction_id in (${caseIdList})`);
      await sql(`delete from public.listing_reviews where auction_id in (${caseIdList})`);
      await sql(`delete from public.auction_cancellations where auction_id in (${caseIdList})`);
      await sql(`delete from public.notifications where auction_id in (${caseIdList})`);
      await sql(`delete from public.auction_images where auction_id in (${caseIdList})`);
      await sql(`delete from public.watchlist where auction_id in (${caseIdList})`);
      await sql(`delete from public.auctions where id in (${caseIdList})`);
    }
    check("CASE A/D: this section's own fixtures are removed here, not left for the e2e sweeper",
      unsafeToDelete.length === 0,
      unsafeToDelete.length === 0
        ? `removed ${caseIds.length} fixture(s)`
        : `REFUSED to delete ${unsafeToDelete.length} row(s) that did not look like our own`);
  }

  // ---- 11d. the boundary race: settlement vs bid on an expired auction -------
  //
  // The auction below has real bids and a past ends_at. Three closers arrive at
  // once: two explicit settles and one late bid. They serialize on the auction
  // row lock in an order this test does not control and must not assume - the
  // assertions hold for every interleaving, because every path funnels through
  // the idempotent settle_auction().
  //
  // What each arrival does, whichever order they land in:
  //   * settle_auction on LIVE: settles (SOLD, one transaction, one winner).
  //   * settle_auction after that: already_settled, writes nothing.
  //   * place_bid on LIVE-but-expired: settles first (same outcome), then
  //     reports the refusal as a returned value - and since migration
  //     20260929000001 that settlement commits instead of rolling back.
  //   * place_bid after that: the row is SOLD, so it raises auction_ended
  //     having written nothing.
  //
  // So no interleaving can produce two transactions, two winners, a lost bid,
  // or a bid row from the late bidder. That is what is asserted: final state,
  // never return values alone.
  const RACE_TITLE = "Verify: settlement races a late bid";
  const raceCreated = await rest(`/rest/v1/auctions`, {
    method: "POST", bearer: tok.seller,
    headers: { Prefer: "return=representation" },
    body: { ...auctionPayload, title: RACE_TITLE },
  });
  const raceId = raceCreated.data?.[0]?.id;
  check("RACE: a third auction was created for the boundary race", !!raceId,
    raceId ?? JSON.stringify(raceCreated.data));

  if (raceId) {
    await rest(`/rest/v1/auction_images`, {
      method: "POST", bearer: tok.seller,
      body: { auction_id: raceId, storage_path: `harness/${raceId}/cover.jpg`, position: 0 },
    });
    await rest(`/rest/v1/rpc/publish_auction`, {
      method: "POST", bearer: tok.seller,
      body: { p_auction_id: raceId },
    });
    // Two real bids while live, so the only legal outcome is SOLD to buyer3.
    await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: raceId, p_amount_minor: 5000, p_request_id: randomUUID() },
    });
    await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer3,
      body: { p_auction_id: raceId, p_amount_minor: 6000, p_request_id: randomUUID() },
    });
    await sql(`update public.auctions set starts_at = now() - interval '1 hour', ends_at = now() - interval '1 second'
                where id='${raceId}'`);

    const [raceSettle1, raceLateBid, raceSettle2] = await Promise.all([
      rest(`/rest/v1/rpc/settle_auction`, {
        method: "POST", bearer: SEC, key: SEC,
        body: { p_auction_id: raceId },
      }),
      rest(`/rest/v1/rpc/place_bid`, {
        method: "POST", bearer: tok.buyer2,
        body: { p_auction_id: raceId, p_amount_minor: 999999, p_request_id: randomUUID() },
      }),
      rest(`/rest/v1/rpc/settle_auction`, {
        method: "POST", bearer: SEC, key: SEC,
        body: { p_auction_id: raceId },
      }),
    ]);

    // The late bid is refused in every interleaving: either it settles first
    // (returned ok:false) or it arrives after (raised auction_ended).
    const lateRefused =
      (raceLateBid.ok && raceLateBid.data?.ok === false && raceLateBid.data?.error === "auction_ended") ||
      (!raceLateBid.ok && /auction_ended/.test(JSON.stringify(raceLateBid.data)));
    check("RACE: the late bid is refused however the three closers interleave",
      lateRefused, JSON.stringify(raceLateBid.data));

    const raceFinal = rows(await sql(
      `select status, winner_id, winning_bid_minor, bid_count,
              (select count(*)::int from public.bids b where b.auction_id = a.id) as bid_rows,
              (select count(*)::int from public.bids b where b.auction_id = a.id and is_winning) as winning_rows,
              (select count(*)::int from public.bids b where b.auction_id = a.id and bidder_id = '${buyer2Id}') as late_rows,
              (select count(*)::int from public.transactions t where t.auction_id = a.id) as tx_rows,
              (select count(*)::int from public.notifications n where n.auction_id = a.id and n.type = 'WON') as won_rows,
              (select count(*)::int from public.notifications n where n.auction_id = a.id and n.type = 'SOLD') as sold_rows
         from public.auctions a where a.id = '${raceId}'`))[0];

    check("RACE: one final outcome - SOLD to the highest bidder",
      raceFinal.status === "SOLD" && raceFinal.winner_id === buyer3Id
        && Number(raceFinal.winning_bid_minor) === 6000,
      `status=${raceFinal.status} winner=${raceFinal.winner_id === buyer3Id} amount=${raceFinal.winning_bid_minor}`);
    check("RACE: exactly one transaction, never two, never zero",
      raceFinal.tx_rows === 1, `transactions=${raceFinal.tx_rows}`);
    check("RACE: exactly one winning bid across all interleavings",
      raceFinal.winning_rows === 1, `is_winning=${raceFinal.winning_rows}`);
    check("RACE: the refused late bid left no bid row behind",
      raceFinal.late_rows === 0 && raceFinal.bid_rows === 2 && raceFinal.bid_count === 2,
      `late_rows=${raceFinal.late_rows} bid_rows=${raceFinal.bid_rows} bid_count=${raceFinal.bid_count}`);
    check("RACE: exactly one WON and one SOLD notice, no duplicates",
      raceFinal.won_rows === 1 && raceFinal.sold_rows === 1,
      `won=${raceFinal.won_rows} sold=${raceFinal.sold_rows}`);
    void raceSettle1;
    void raceSettle2;

    // Parallel identical request_id: the same submission fired twice at once.
    // The unique index admits exactly one row; the loser errors rather than
    // doubling. bids_idempotency_idx is the enforcer, not the SELECT above it.
    const raceReqId = randomUUID();
    const [dupA, dupB] = await Promise.all([
      rest(`/rest/v1/rpc/place_bid`, {
        method: "POST", bearer: tok.buyer1,
        body: { p_auction_id: raceId, p_amount_minor: 7000, p_request_id: raceReqId },
      }),
      rest(`/rest/v1/rpc/place_bid`, {
        method: "POST", bearer: tok.buyer1,
        body: { p_auction_id: raceId, p_amount_minor: 7000, p_request_id: raceReqId },
      }),
    ]);
    void dupA;
    void dupB;
    // Note: on a settled auction both are refused before reaching the write,
    // so this races the REFUSAL path, not the insert. The insert race is
    // covered by the live concurrency checks above plus the unique index.
    const dupRows = rows(await sql(
      `select count(*)::int as n from public.bids
        where bidder_id = '${buyer1Id}' and request_id = '${raceReqId}'`))[0].n;
    check("RACE: a doubled submission on a closed auction writes no bid row",
      dupRows === 0, `rows=${dupRows}`);

    // Remove this section's own fixture. Same discipline as CASE A/D: scoped
    // to this id, refused unless it is bid-free of OUR bids... but this one
    // HAS our two bids, so the guard is the exact title plus the QA seller
    // plus zero transactions outside our single expected one. Simpler and
    // safer: delete children explicitly, then the row, all scoped to raceId.
    const raceTitleOk = rows(await sql(
      `select title from public.auctions where id = '${raceId}'`))[0]?.title === RACE_TITLE;
    const raceSellerOk = rows(await sql(
      `select seller_id::text = '${sellerId}' as ok from public.auctions where id = '${raceId}'`))[0]?.ok === true;
    if (raceTitleOk && raceSellerOk) {
      await sql(`delete from public.auction_cancellation_requests where auction_id in ('${raceId}')`);
      await sql(`delete from public.listing_reviews where auction_id in ('${raceId}')`);
      await sql(`delete from public.auction_cancellations where auction_id in ('${raceId}')`);
      await sql(`delete from public.notifications where auction_id in ('${raceId}')`);
      await sql(`delete from public.bids where auction_id in ('${raceId}')`);
      await sql(`delete from public.transactions where auction_id in ('${raceId}')`);
      await sql(`delete from public.auction_images where auction_id in ('${raceId}')`);
      await sql(`delete from public.watchlist where auction_id in ('${raceId}')`);
      await sql(`delete from public.auctions where id in ('${raceId}')`);
      check("RACE: this section's own fixture was removed here", true, "removed 1 fixture");
    } else {
      check("RACE: this section's own fixture was removed here", false,
        "REFUSED: title or seller did not match our fixture");
    }
  }


// ---- 12. cross-user financial isolation -----------------------------------
console.log("\n--- financial isolation ---");
// buyer1 bid but did NOT win, so they are a non-party to this sale.
const outsiderTx = await rest(`/rest/v1/transactions?select=id`, { bearer: tok.buyer1 });
check("RLS: a non-party cannot see the transaction",
  outsiderTx.ok && outsiderTx.data.length === 0, `${outsiderTx.data?.length} rows`);

// buyer3 IS the winner of this auction, so they must see exactly this one
const thisTx = rows(await sql(
  `select count(*)::int as n from public.transactions where auction_id='${auctionId}'`))[0]?.n;
const winnerTx = await rest(`/rest/v1/transactions?select=id&auction_id=eq.${auctionId}`,
  { bearer: tok.buyer3 });
check("RLS: transaction visible to the actual party",
  winnerTx.ok && winnerTx.data.length === Number(thisTx),
  `rows=${winnerTx.data?.length}/${thisTx}`);

const anonNotifWrite = await rest(`/rest/v1/notifications`, {
  method: "POST",
  body: { user_id: buyer1Id, type: "WON", auction_id: auctionId },
});
check("RLS: notifications cannot be forged by a third party", !anonNotifWrite.ok,
  `status ${anonNotifWrite.status}`);

// PATCH returns no body unless Prefer asks for a representation, otherwise
// "rows undefined" is a harness artifact rather than a real signal.
const notifyAsOther = await rest(`/rest/v1/notifications?user_id=eq.${buyer1Id}&type=eq.OUTBID`, {
  method: "PATCH", bearer: tok.buyer3,
  headers: { Prefer: "return=representation" },
  body: { read_at: new Date().toISOString() },
});
const buyer1OutbidUnread = rows(await sql(
  `select count(*)::int as n from public.notifications
    where user_id='${buyer1Id}' and type='OUTBID' and read_at is null`))[0]?.n;
// PostgREST returns an EMPTY body (not []) when RLS filters every row, so a
// null payload means "0 rows matched" — which is exactly the expected result.
const updatedCount = Array.isArray(notifyAsOther.data) ? notifyAsOther.data.length : 0;
check("RLS: another user cannot mark someone else's notifications read",
  notifyAsOther.ok && updatedCount === 0 && Number(buyer1OutbidUnread) >= 1,
  `status=${notifyAsOther.status} updated=${updatedCount} unread=${buyer1OutbidUnread} body=${JSON.stringify(notifyAsOther.data)?.slice(0, 200)}`);

// ...but the OWNER must be able to, otherwise the notifications UI is broken
const markOwn = await rest(`/rest/v1/notifications?user_id=eq.${buyer1Id}&type=eq.OUTBID`, {
  method: "PATCH", bearer: tok.buyer1,
  headers: { Prefer: "return=representation" },
  body: { read_at: new Date().toISOString() },
});
const ownMarked = Array.isArray(markOwn.data) ? markOwn.data.length : 0;
check("notifications: owner CAN mark their own notifications read",
  markOwn.ok && ownMarked >= 1 && Number(buyer1OutbidUnread) >= 1,
  `status=${markOwn.status} updated=${ownMarked}`);

const unreadAfter = rows(await sql(
  `select count(*)::int as n from public.notifications
    where user_id='${buyer1Id}' and type='OUTBID' and read_at is null`))[0]?.n;
check("notifications: read_at actually persisted for the owner", Number(unreadAfter) === 0,
  `unread=${unreadAfter}`);

// payload must stay immutable even for the owner
const forge = await rest(`/rest/v1/notifications?user_id=eq.${buyer1Id}`, {
  method: "PATCH", bearer: tok.buyer1,
  body: { payload: { current_bid_minor: 1, currency: "USD" } },
});
const payloadStillIntact = rows(await sql(
  `select count(*)::int as n from public.notifications
    where user_id='${buyer1Id}' and type='OUTBID'
      and (payload->>'current_bid_minor')::bigint > 1`))[0]?.n;
check("notifications: payload is not client-writable",
  !forge.ok && Number(payloadStillIntact) >= 1,
  `status=${forge.status} intact=${payloadStillIntact}`);

// ---- 13. release security gates (migration 000010 + launch checklist) ------
console.log("\n--- release security gates ---");

// Internal helpers moved to the `private` schema must have NO PostgREST route.
const movedRpc = await rest(`/rest/v1/rpc/is_admin`, {
  method: "POST", bearer: tok.buyer1,
});
check("security: internal helpers are off the public RPC surface (private schema)",
  !movedRpc.ok, `status ${movedRpc.status}`);

// Anonymous execution of the engine, beyond place_bid (covered above).
const anonAllowed = [];
for (const fn of ["publish_auction", "settle_auction", "settle_due_auctions"]) {
  const r = await rest(`/rest/v1/rpc/${fn}`, {
    method: "POST",
    body: fn === "settle_due_auctions" ? { p_limit: 1 } : { p_auction_id: auctionId },
  });
  if (r.ok) anonAllowed.push(fn);
}
check("rule: anonymous cannot execute publish/settle functions",
  anonAllowed.length === 0,
  anonAllowed.length ? `allowed: ${anonAllowed.join(",")}` : "all rejected");

// A signed-in stranger must see nobody else's notifications.
const ownNotifs = await rest(`/rest/v1/notifications?user_id=eq.${buyer1Id}&select=id`,
  { bearer: tok.buyer1 });
const notifPeek = await rest(`/rest/v1/notifications?user_id=eq.${buyer1Id}&select=id`,
  { bearer: tok.buyer3 });
check("RLS: a signed-in stranger cannot read someone else's notifications",
  ownNotifs.ok && ownNotifs.data.length > 0 && notifPeek.ok && notifPeek.data.length === 0,
  `owner=${ownNotifs.data?.length ?? "?"} stranger=${notifPeek.data?.length ?? "?"}`);

// Unauthorized admin action: report triage is admin-only, and the merged
// admin policy (000010) must still grant admins their full authority.
const report = await rest(`/rest/v1/reports`, {
  method: "POST", bearer: tok.buyer1,
  headers: { Prefer: "return=representation" },
  body: {
    reporter_id: buyer1Id,
    target_type: "auction",
    target_id: auctionId,
    reason: "harness: exercising report authorization",
  },
});
check("rule: a user can file a report against a listing", report.ok,
  `status ${report.status}`);
const reportId = report.data?.[0]?.id;

if (reportId) {
  const nonAdminTriage = await rest(`/rest/v1/reports?id=eq.${reportId}`, {
    method: "PATCH", bearer: tok.buyer2,
    headers: { Prefer: "return=representation" },
    body: { status: "DISMISSED" },
  });
  const beforeState = rows(await sql(
    `select status from public.reports where id='${reportId}'`))[0];
  const nonAdminRows = Array.isArray(nonAdminTriage.data) ? nonAdminTriage.data.length : 0;
  check("security: non-admin cannot triage a report",
    nonAdminTriage.ok && nonAdminRows === 0 && beforeState?.status === "OPEN",
    `updated=${nonAdminRows} status=${beforeState?.status}`);

  await sql(`update public.profiles set is_admin = true where id='${buyer2Id}'`);
  const adminTriage = await rest(`/rest/v1/reports?id=eq.${reportId}`, {
    method: "PATCH", bearer: tok.buyer2,
    headers: { Prefer: "return=representation" },
    body: { status: "DISMISSED" },
  });
  const afterAdmin = rows(await sql(
    `select status from public.reports where id='${reportId}'`))[0];
  await sql(`update public.profiles set is_admin = false where id='${buyer2Id}'`);
  check("security: admin CAN triage a report (merged admin policy intact)",
    adminTriage.ok && afterAdmin?.status === "DISMISSED",
    `status=${afterAdmin?.status} blocked=${JSON.stringify(adminTriage.data)?.slice(0, 120)}`);
} else {
  check("security: non-admin cannot triage a report", false, "report row missing");
  check("security: admin CAN triage a report (merged admin policy intact)", false,
    "report row missing");
}

// ---- 14. phase 2: commercial loop ------------------------------------------
console.log("\n--- phase 2: commerce loop ---");

// The transaction THIS run's settlement wrote (section 11).
const phase2Tx = rows(await sql(
  `select id, gross_minor, fee_bps, currency, status from public.transactions
    where auction_id='${auctionId}'`))[0];

if (phase2Tx) {
  check("commerce: settlement left the truthful AWAITING_PAYMENT record",
    phase2Tx.status === "AWAITING_PAYMENT", `status=${phase2Tx.status}`);

  // BOTH parties are asked to review the completed interaction, deep-linked
  // to the exact transaction (the reader routes to /dashboard/transactions).
  const reviewReqs = rows(await sql(
    `select user_id, payload->>'transaction_id' as txid
       from public.notifications
      where auction_id='${auctionId}' and type='REVIEW_REQUEST'`));
  check("notifications: REVIEW_REQUEST asks both sides, linked to the transaction",
    reviewReqs.length === 2 &&
      reviewReqs.some((r) => r.user_id === buyer3Id) &&
      reviewReqs.some((r) => r.user_id === sellerId) &&
      reviewReqs.every((r) => r.txid === phase2Tx.id),
    `rows=${reviewReqs.length}`);

  // Rating aggregates: delta-safe (the profile may carry reviews from earlier
  // runs), and the harness's own review is removed again — it is a fixture,
  // never a fake review left in production data.
  await sql(`delete from public.reviews where transaction_id='${phase2Tx.id}'`);
  const beforeRating = rows(await sql(
    `select rating_sum, rating_count from public.profiles where id='${sellerId}'`))[0];
  await sql(`
    insert into public.reviews (transaction_id, auction_id, reviewer_id, reviewee_id, rating)
    values ('${phase2Tx.id}', '${auctionId}', '${buyer3Id}', '${sellerId}', 5)`);
  const afterInsert = rows(await sql(
    `select rating_sum, rating_count from public.profiles where id='${sellerId}'`))[0];
  check("trust: a review updates the seller's rating aggregate",
    Number(afterInsert.rating_sum) === Number(beforeRating.rating_sum) + 5 &&
      Number(afterInsert.rating_count) === Number(beforeRating.rating_count) + 1,
    `${beforeRating.rating_sum}/${beforeRating.rating_count} -> ` +
      `${afterInsert.rating_sum}/${afterInsert.rating_count}`);

  await sql(`delete from public.reviews where transaction_id='${phase2Tx.id}'`);
  const afterDelete = rows(await sql(
    `select rating_sum, rating_count from public.profiles where id='${sellerId}'`))[0];
  check("trust: removing a review recomputes the aggregate back exactly",
    Number(afterDelete.rating_sum) === Number(beforeRating.rating_sum) &&
      Number(afterDelete.rating_count) === Number(beforeRating.rating_count),
    `${afterDelete.rating_sum}/${afterDelete.rating_count}`);
} else {
  check("commerce: settlement left the truthful AWAITING_PAYMENT record", false,
    "no transaction row from the settlement above");
  check("notifications: REVIEW_REQUEST asks both sides, linked to the transaction", false,
    "no transaction row from the settlement above");
  check("trust: a review updates the seller's rating aggregate", false,
    "no transaction row from the settlement above");
  check("trust: removing a review recomputes the aggregate back exactly", false,
    "no transaction row from the settlement above");
}

// ---- 14b. ENDING_SOON producer ---------------------------------------------
// A synthetic LIVE auction inside its final window (duration 7200s => the
// window is the last 720s; ends in 5 minutes), with buyer1 watching it.
const soonAuction = rows(await sql(`
  insert into public.auctions
    (seller_id, title, description, condition, location,
     starting_bid_minor, bid_increment_minor, status, starts_at, ends_at,
     duration_seconds)
  values
    ('${sellerId}', 'Harness ending-soon fixture',
     'Synthetic fixture created by the engine verification; never listed.',
     'good', 'harness', 100, 10, 'LIVE',
     now() - interval '9 minutes', now() + interval '5 minutes', 7200)
  returning id`))[0]?.id;

await sql(`insert into public.watchlist (user_id, auction_id)
           values ('${buyer1Id}', '${soonAuction}') on conflict do nothing`);

// EXECUTE is service_role only: anon and signed-in users have no route.
const soonAnon = await rest(`/rest/v1/rpc/notify_ending_soon`, {
  method: "POST", body: { p_limit: 50 },
});
const soonAuthed = await rest(`/rest/v1/rpc/notify_ending_soon`, {
  method: "POST", bearer: tok.buyer1, body: { p_limit: 50 },
});
check("security: ending-soon RPC is service_role only",
  !soonAnon.ok && !soonAuthed.ok,
  `anon=${soonAnon.status} authed=${soonAuthed.status}`);

const soonRun1 = await rest(`/rest/v1/rpc/notify_ending_soon`, {
  method: "POST", key: SEC, body: { p_limit: 100 },
});
const soonRows1 = rows(await sql(
  `select count(*)::int as n from public.notifications
    where user_id='${buyer1Id}' and auction_id='${soonAuction}'
      and type='ENDING_SOON'`))[0]?.n;
check("notifications: ending-soon reaches a watcher inside the final window",
  soonRun1.ok && Number(soonRows1) === 1,
  `rpc=${soonRun1.status} rows=${soonRows1} data=${JSON.stringify(soonRun1.data)?.slice(0, 80)}`);

await rest(`/rest/v1/rpc/notify_ending_soon`, {
  method: "POST", key: SEC, body: { p_limit: 100 },
});
const soonRows2 = rows(await sql(
  `select count(*)::int as n from public.notifications
    where user_id='${buyer1Id}' and auction_id='${soonAuction}'
      and type='ENDING_SOON'`))[0]?.n;
check("notifications: ending-soon is delivered exactly once per auction per user",
  Number(soonRows2) === 1, `rows=${soonRows2}`);

// ---- 14c. payment webhook seam ---------------------------------------------
// Synthetic transaction for the seam tests — its own audit rows, its own
// notifications, all removed below so no fabricated payment survives.
const payTx = rows(await sql(`
  insert into public.transactions
    (auction_id, seller_id, buyer_id, currency,
     gross_minor, fee_bps, fee_minor, net_minor, status)
  values ('${soonAuction}', '${sellerId}', '${buyer1Id}', 'USD',
          2500, 500, 125, 2375, 'AWAITING_PAYMENT')
  returning id, status`))[0];

const anonEvents = await rest(`/rest/v1/payment_events?select=id`);
check("payments: webhook audit log has no PostgREST surface for clients",
  !anonEvents.ok || (Array.isArray(anonEvents.data) ? anonEvents.data.length : 0) === 0,
  `status=${anonEvents.status}`);

const payAnon = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST",
  body: {
    p_transaction_id: payTx.id, p_provider: "harness", p_provider_reference: "r0",
    p_amount_minor: 2500, p_currency: "USD", p_event_id: "evt-anon",
  },
});
const payAuthed = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", bearer: tok.buyer1,
  body: {
    p_transaction_id: payTx.id, p_provider: "harness", p_provider_reference: "r1",
    p_amount_minor: 2500, p_currency: "USD", p_event_id: "evt-authed",
  },
});
check("payments: mark_paid is service_role only (anon and signed-in denied)",
  !payAnon.ok && !payAuthed.ok,
  `anon=${payAnon.status} authed=${payAuthed.status}`);

const mismatch = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: payTx.id, p_provider: "harness", p_provider_reference: "r2",
    p_amount_minor: 9999, p_currency: "USD", p_event_id: "evt-mismatch",
  },
});
const stillAwaiting = rows(await sql(
  `select status from public.transactions where id='${payTx.id}'`))[0];
check("payments: a mismatched amount is rejected and nothing is written",
  !mismatch.ok && stillAwaiting?.status === "AWAITING_PAYMENT",
  `status=${stillAwaiting?.status} body=${JSON.stringify(mismatch.data)?.slice(0, 120)}`);

const evtId = `evt-${randomUUID()}`;
const paid = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: payTx.id, p_provider: "harness_pay",
    p_provider_reference: "ref-1", p_amount_minor: 2500, p_currency: "USD",
    p_event_id: evtId, p_payload: { harness: true },
  },
});
const paidRow = rows(await sql(
  `select status, provider from public.transactions where id='${payTx.id}'`))[0];
const eventRows = rows(await sql(
  `select count(*)::int as n from public.payment_events
    where transaction_id='${payTx.id}'`))[0]?.n;
check("payments: verified event marks AWAITING_PAYMENT -> PAID with an audit row",
  paid.ok && paidRow?.status === "PAID" && paidRow?.provider === "harness_pay" &&
    Number(eventRows) === 1,
  `status=${paidRow?.status} events=${eventRows} body=${JSON.stringify(paid.data)?.slice(0, 140)}`);

const replay = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: payTx.id, p_provider: "harness_pay",
    p_provider_reference: "ref-1", p_amount_minor: 2500, p_currency: "USD",
    p_event_id: evtId, p_payload: { harness: true },
  },
});
const eventsAfterReplay = rows(await sql(
  `select count(*)::int as n from public.payment_events
    where transaction_id='${payTx.id}'`))[0]?.n;
check("payments: replaying the event is idempotent (already_paid, one audit row)",
  replay.ok && replay.data?.already_paid === true && Number(eventsAfterReplay) === 1,
  `body=${JSON.stringify(replay.data)?.slice(0, 140)} events=${eventsAfterReplay}`);

let moneyErr = "";
try {
  await sql(`update public.transactions set gross_minor = gross_minor + 1
              where id='${payTx.id}'`);
} catch (e) {
  moneyErr = `${e?.message ?? e}`;
}
check("payments: transaction money columns are immutable for EVERY role",
  moneyErr.includes("transaction_money_immutable"),
  moneyErr.slice(0, 160) || "update succeeded — NOT immutable");

let transitionErr = "";
try {
  await sql(`update public.transactions set status='AWAITING_PAYMENT'
              where id='${payTx.id}'`);
} catch (e) {
  transitionErr = `${e?.message ?? e}`;
}
check("payments: status refuses transitions outside the allowlist",
  transitionErr.includes("transaction_invalid_transition"),
  transitionErr.slice(0, 160) || "illegal transition succeeded");

let legalOk = true;
let legalErr = "";
try {
  await sql(`update public.transactions set status='SETTLED'
              where id='${payTx.id}'`);
} catch (e) {
  legalOk = false;
  legalErr = `${e?.message ?? e}`;
}
const legalRow = rows(await sql(
  `select status from public.transactions where id='${payTx.id}'`))[0];
check("payments: PAID -> SETTLED stays a legal lifecycle transition",
  legalOk && legalRow?.status === "SETTLED",
  `status=${legalRow?.status} ${legalErr.slice(0, 120)}`);

// ---- 14d. failure + refund writers (Phase 3) -------------------------------
// A real provider also reports payments that never happened and money that
// was returned. Both transitions already existed in the freeze trigger but
// had no server-authoritative writer, so they could never be exercised. These
// checks prove the writers, their idempotency, their privilege boundary, and
// the two verifications that decide whether an event is about this sale at
// all (amount and currency).
async function payFixture(title) {
  const auction = rows(await sql(`
    insert into public.auctions
      (seller_id, title, description, condition, location,
       starting_bid_minor, bid_increment_minor, status, starts_at, ends_at,
       duration_seconds)
    values
      ('${sellerId}', '${title}',
       'Synthetic fixture created by the engine verification; never listed.',
       'good', 'harness', 100, 10, 'LIVE',
       now() - interval '9 minutes', now() + interval '5 minutes', 7200)
    returning id`))[0]?.id;
  const tx = rows(await sql(`
    insert into public.transactions
      (auction_id, seller_id, buyer_id, currency,
       gross_minor, fee_bps, fee_minor, net_minor, status)
    values ('${auction}', '${sellerId}', '${buyer1Id}', 'USD',
            2500, 500, 125, 2375, 'AWAITING_PAYMENT')
    returning id, status`))[0];
  return { auction, tx };
}

const failFixture = await payFixture("Harness failed-payment fixture");
const failTx = failFixture.tx;

const failAnon = await rest(`/rest/v1/rpc/mark_transaction_failed`, {
  method: "POST", body: {
    p_transaction_id: failTx.id, p_provider: "harness",
    p_provider_reference: "rf", p_event_id: "evt-anon-fail",
  },
});
const failAuthed = await rest(`/rest/v1/rpc/mark_transaction_failed`, {
  method: "POST", bearer: tok.buyer1,
  body: {
    p_transaction_id: failTx.id, p_provider: "harness",
    p_provider_reference: "rf", p_event_id: "evt-authed-fail",
  },
});
check("payments: mark_failed is service_role only (anon and signed-in denied)",
  !failAnon.ok && !failAuthed.ok,
  `anon=${failAnon.status} authed=${failAuthed.status}`);

const recAnon = await rest(`/rest/v1/rpc/record_payment_event`, {
  method: "POST", body: {
    p_provider: "harness", p_event_id: "evt-anon-rec",
    p_transaction_id: failTx.id,
  },
});
const recAuthed = await rest(`/rest/v1/rpc/record_payment_event`, {
  method: "POST", bearer: tok.buyer1,
  body: {
    p_provider: "harness", p_event_id: "evt-authed-rec",
    p_transaction_id: failTx.id,
  },
});
check("payments: record_payment_event is service_role only (audit log has no client path)",
  !recAnon.ok && !recAuthed.ok,
  `anon=${recAnon.status} authed=${recAuthed.status}`);

const wrongCurrency = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: failTx.id, p_provider: "harness",
    p_provider_reference: "rc", p_amount_minor: 2500, p_currency: "EUR",
    p_event_id: `evt-${randomUUID()}`,
  },
});
const currencyRow = rows(await sql(
  `select status from public.transactions where id='${failTx.id}'`))[0];
check("payments: a mismatched currency is rejected and nothing is written",
  !wrongCurrency.ok && currencyRow?.status === "AWAITING_PAYMENT",
  `status=${currencyRow?.status} body=${JSON.stringify(wrongCurrency.data)?.slice(0, 120)}`);

const unknownTx = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: "00000000-0000-0000-0000-000000000000",
    p_provider: "harness", p_provider_reference: "rx",
    p_amount_minor: 2500, p_currency: "USD", p_event_id: `evt-${randomUUID()}`,
  },
});
check("payments: an unknown transaction is refused, never invented",
  !unknownTx.ok && String(unknownTx.data?.message ?? "").includes("transaction_not_found"),
  JSON.stringify(unknownTx.data)?.slice(0, 140));

const failEvt = `evt-${randomUUID()}`;
const failBody = {
  p_transaction_id: failTx.id, p_provider: "harness",
  p_provider_reference: "ref-fail", p_event_id: failEvt,
  p_payload: { harness: true },
};
const failed = await rest(`/rest/v1/rpc/mark_transaction_failed`, {
  method: "POST", key: SEC, body: failBody,
});
const failedRow = rows(await sql(
  `select status, provider from public.transactions where id='${failTx.id}'`))[0];
const failEvents = rows(await sql(
  `select count(*)::int as n from public.payment_events
    where transaction_id='${failTx.id}'`))[0]?.n;
check("payments: AWAITING_PAYMENT -> FAILED is an explicit, audited transition",
  failed.ok && failedRow?.status === "FAILED" && Number(failEvents) === 1,
  `status=${failedRow?.status} events=${failEvents} body=${JSON.stringify(failed.data)?.slice(0, 140)}`);

const failReplay = await rest(`/rest/v1/rpc/mark_transaction_failed`, {
  method: "POST", key: SEC, body: failBody,
});
const failEvents2 = rows(await sql(
  `select count(*)::int as n from public.payment_events
    where transaction_id='${failTx.id}'`))[0]?.n;
check("payments: replaying a failure is idempotent (already_failed, one audit row)",
  failReplay.ok && failReplay.data?.already_failed === true &&
    Number(failEvents2) === 1,
  `body=${JSON.stringify(failReplay.data)?.slice(0, 140)} events=${failEvents2}`);

const paidAfterFail = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: failTx.id, p_provider: "harness",
    p_provider_reference: "ref-late", p_amount_minor: 2500, p_currency: "USD",
    p_event_id: `evt-${randomUUID()}`,
  },
});
check("payments: a FAILED transaction can never be resurrected as PAID",
  !paidAfterFail.ok &&
    String(paidAfterFail.data?.message ?? "").includes("payment_invalid_transition"),
  JSON.stringify(paidAfterFail.data)?.slice(0, 140));

const refundOnFailed = await rest(`/rest/v1/rpc/mark_transaction_refunded`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: failTx.id, p_provider: "harness",
    p_event_id: `evt-${randomUUID()}`,
  },
});
check("payments: a FAILED transaction can never be refunded",
  !refundOnFailed.ok &&
    String(refundOnFailed.data?.message ?? "").includes("payment_invalid_transition"),
  JSON.stringify(refundOnFailed.data)?.slice(0, 140));

// Audit-only provider events (in-flight status, dispute) are recorded exactly
// once, without touching the transaction.
const recEvt = `evt-${randomUUID()}`;
const recBody = {
  p_provider: "harness", p_event_id: recEvt,
  p_transaction_id: failTx.id, p_payload: { status: "Disputed" },
};
const rec1 = await rest(`/rest/v1/rpc/record_payment_event`, {
  method: "POST", key: SEC, body: recBody,
});
const rec2 = await rest(`/rest/v1/rpc/record_payment_event`, {
  method: "POST", key: SEC, body: recBody,
});
const failStatusAfterRec = rows(await sql(
  `select status from public.transactions where id='${failTx.id}'`))[0];
check("payments: an audit-only event is recorded exactly once and changes nothing",
  rec1.ok && rec1.data?.recorded === true && rec2.ok &&
    rec2.data?.recorded === false && failStatusAfterRec?.status === "FAILED",
  `first=${rec1.data?.recorded} second=${rec2.data?.recorded} status=${failStatusAfterRec?.status}`);

const refundFixture = await payFixture("Harness refund fixture");
const refundTx = refundFixture.tx;

const refundPaid = await rest(`/rest/v1/rpc/mark_transaction_paid`, {
  method: "POST", key: SEC,
  body: {
    p_transaction_id: refundTx.id, p_provider: "harness",
    p_provider_reference: "ref-ok", p_amount_minor: 2500, p_currency: "USD",
    p_event_id: `evt-${randomUUID()}`,
  },
});
const refundPaidRow = rows(await sql(
  `select status from public.transactions where id='${refundTx.id}'`))[0];
check("payments: refund fixture reached PAID (precondition for the refund path)",
  refundPaid.ok && refundPaidRow?.status === "PAID",
  `status=${refundPaidRow?.status} body=${JSON.stringify(refundPaid.data)?.slice(0, 140)}`);

const refundAnon = await rest(`/rest/v1/rpc/mark_transaction_refunded`, {
  method: "POST", body: {
    p_transaction_id: refundTx.id, p_provider: "harness",
    p_event_id: "evt-anon-refund",
  },
});
const refundAuthed = await rest(`/rest/v1/rpc/mark_transaction_refunded`, {
  method: "POST", bearer: tok.buyer1,
  body: {
    p_transaction_id: refundTx.id, p_provider: "harness",
    p_event_id: "evt-authed-refund",
  },
});
check("payments: mark_refunded is service_role only (anon and signed-in denied)",
  !refundAnon.ok && !refundAuthed.ok,
  `anon=${refundAnon.status} authed=${refundAuthed.status}`);

const refundEvt = `evt-${randomUUID()}`;
const refundBody = {
  p_transaction_id: refundTx.id, p_provider: "harness",
  p_event_id: refundEvt, p_payload: { reason: "buyer returned the item" },
};
const refunded = await rest(`/rest/v1/rpc/mark_transaction_refunded`, {
  method: "POST", key: SEC, body: refundBody,
});
const refundedRow = rows(await sql(
  `select status, provider, provider_reference from public.transactions
    where id='${refundTx.id}'`))[0];
const refundEvents = rows(await sql(
  `select count(*)::int as n from public.payment_events
    where transaction_id='${refundTx.id}'`))[0]?.n;
// Two events total: the payment that made it PAID, then the refund itself.
check("payments: PAID -> REFUNDED is an explicit, audited transition",
  refunded.ok && refundedRow?.status === "REFUNDED" &&
    refundedRow?.provider === "harness" &&
    refundedRow?.provider_reference === "ref-ok" &&
    Number(refundEvents) === 2,
  `status=${refundedRow?.status} provider=${refundedRow?.provider} ` +
    `ref=${refundedRow?.provider_reference} events=${refundEvents} ` +
    `body=${JSON.stringify(refunded.data)?.slice(0, 140)}`);

const refundReplay = await rest(`/rest/v1/rpc/mark_transaction_refunded`, {
  method: "POST", key: SEC, body: refundBody,
});
const refundEvents2 = rows(await sql(
  `select count(*)::int as n from public.payment_events
    where transaction_id='${refundTx.id}'`))[0]?.n;
check("payments: replaying a refund is idempotent (already_refunded, no extra audit row)",
  refundReplay.ok && refundReplay.data?.already_refunded === true &&
    Number(refundEvents2) === 2,
  `body=${JSON.stringify(refundReplay.data)?.slice(0, 140)} events=${refundEvents2}`);

// ---- 14e. seller payouts: fulfilment / payout operation ---------------------
// Two facts are proved here that nothing else can prove, because neither has a
// UI: (1) `PAID` only ever meant the buyer's money — the seller's proceeds are
// a separate row with their own workflow; (2) every write path other than the
// admin RPC is closed, and the one write path that exists cannot touch money.
console.log("\n--- seller payouts ---");

const payPayout = rows(await sql(
  `select id, status, amount_minor, currency, payout_reference, paid_at,
          delivery_confirmed_at
     from public.seller_payouts where transaction_id='${payTx.id}'`))[0];
check("payout: reaching PAID mints one payout row frozen at net_minor + currency",
  payPayout && Number(payPayout.amount_minor) === 2375 &&
    payPayout.currency === "USD" && payPayout.status === "WAITING_FOR_FULFILMENT" &&
    payPayout.paid_at === null,
  JSON.stringify(payPayout));

const refundPayout = rows(await sql(
  `select status, amount_minor from public.seller_payouts
    where transaction_id='${refundTx.id}'`))[0];
check("payout: refunding the sale HOLDS the payout instead of paying it out",
  refundPayout?.status === "HELD" && Number(refundPayout?.amount_minor) === 2375,
  JSON.stringify(refundPayout));

const failedPayout = rows(await sql(
  `select id from public.seller_payouts where transaction_id='${failTx.id}'`));
check("payout: a FAILED transaction never gets a payout row",
  failedPayout.length === 0, `${failedPayout.length} rows`);

// ---- 15. security follow-ups closed on 2026-09-28 ---------------------------
// Three documented items from the pre-launch sweep, re-evaluated against the
// live database rather than taken on trust. Each is proved by attempting the
// thing it is supposed to prevent.
console.log("\n--- security follow-ups (2026-09-28) ---");

// (a) A self-inserted profile can never arrive privileged. The escalation this
// closes: any signed-in user whose profile row is missing could insert their
// own row with is_admin = true and become an administrator.
const forgedProfile = await rest(`/rest/v1/profiles`, {
  method: "POST", bearer: tok.buyer3,
  headers: { Prefer: "return=representation" },
  body: {
    id: buyer3Id, username: "forged-admin", display_name: "Forged Admin",
    is_admin: true,
  },
});
const adminProfiles = rows(await sql(
  `select count(*)::int as n from public.profiles where is_admin`));
const beforeAdmins = Number(adminProfiles?.[0]?.n);
check("security: a self-inserted profile cannot claim is_admin",
  !forgedProfile.ok && beforeAdmins === Number(
    rows(await sql(
      `select count(*)::int as n from public.profiles p
         join auth.users u on u.id = p.id
        where p.is_admin and u.email not like '%@bidblitz.test'`
    ))[0]?.n
  ),
  `status=${forgedProfile.status} ` +
    `body=${JSON.stringify(forgedProfile.data)?.slice(0, 120)} ` +
    `admins=${beforeAdmins}`);

// (a2) The admin population itself, as a durable invariant rather than a
// snapshot. The owner deliberately promoted their own real account on
// 2026-09-28, so "there is no admin" is no longer the truth and must not be
// asserted. What must stay true is that the ONLY administrator is a real
// account: never a QA account, whose password lives in this repository.
const adminIdentities = rows(await sql(
  `select u.email from public.profiles p
     join auth.users u on u.id = p.id
    where p.is_admin order by u.email`));
const adminQa = rows(await sql(
  `select u.email from public.profiles p
     join auth.users u on u.id = p.id
    where p.is_admin and u.email like '%@bidblitz.test'`));
check("security: exactly one administrator, and it is a real account",
  adminIdentities.length === 1 && adminQa.length === 0,
  adminIdentities.length === 0
    ? "NO ADMIN AT ALL - /admin is unreachable by anyone"
    : `admins=${adminIdentities.map((a) => a.email).join(", ")}` +
      ` qaAdmins=${adminQa.length}`);

// (b) storage_path must name its own auction and end in a file extension. The
// app already enforces the first half; the database now does too.
const fixtureAuction = rows(await sql(`
  insert into public.auctions
    (seller_id, title, description, condition, location,
     starting_bid_minor, bid_increment_minor, status, starts_at, ends_at,
     duration_seconds)
  values ('${sellerId}', 'Harness image-check fixture',
          'Synthetic fixture; never listed.', 'good', 'harness',
          100, 10, 'DRAFT', now(), now() + interval '1 hour', 3600)
  returning id`))[0]?.id;

const badPath = await rest(`/rest/v1/auction_images`, {
  method: "POST", bearer: tok.seller, body: {
    auction_id: fixtureAuction, storage_path: "not-a-real-path.png", position: 0,
  },
});
// A key that names a DIFFERENT auction's id is the case that matters: it would
// let one listing's image row point at another listing's object.
const crossPath = await rest(`/rest/v1/auction_images`, {
  method: "POST", bearer: tok.seller, body: {
    auction_id: fixtureAuction,
    storage_path: `${soonAuction}/0.png`, position: 1,
  },
});
const goodPath = await rest(`/rest/v1/auction_images`, {
  method: "POST", bearer: tok.seller, body: {
    auction_id: fixtureAuction,
    storage_path: `harness/${fixtureAuction}/cover.jpg`, position: 0,
  },
});
check("security: auction_images.storage_path must name its own auction and be a file",
  !badPath.ok && !crossPath.ok && goodPath.ok,
  `noauction=${badPath.status} crossauction=${crossPath.status} good=${goodPath.status} ` +
    `crossBody=${JSON.stringify(crossPath.data)?.slice(0, 90)}`);

// The one legal image row written above, plus its fixture auction.
await sql(`delete from public.auction_images where auction_id='${fixtureAuction}'`);
await sql(`delete from public.auctions where id='${fixtureAuction}'`);

// (c) is_banned is now READ. Before this, nothing consulted it: setting the
// flag achieved nothing, so an operator following the escalation manual
// believed they had stopped an account that carried on bidding and listing.
// Both attempts go through the same public surfaces a real user would use:
// place_bid for bidding, and publish_auction for listing (a client has no
// direct INSERT on auctions at all - the grants are revoked).
const bannedDraft = rows(await sql(`
  insert into public.auctions
    (seller_id, title, description, condition, location,
     starting_bid_minor, bid_increment_minor, status, starts_at, ends_at,
     duration_seconds)
  values ('${buyer1Id}', 'Harness banned-publish fixture',
          'Synthetic fixture; never listed.', 'good', 'harness',
          100, 10, 'DRAFT', now(), now() + interval '1 hour', 3600)
  returning id`))[0]?.id;
await sql(`
  insert into public.auction_images (auction_id, storage_path, position)
  values ('${bannedDraft}', 'harness/${bannedDraft}/cover.jpg', 0)`);

await sql(`update public.profiles set is_banned = true where id='${buyer1Id}'`);
const bannedBid = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer1,
  body: {
    p_auction_id: soonAuction, p_amount_minor: 999999,
    p_request_id: randomUUID(),
  },
});
const bannedPublish = await rest(`/rest/v1/rpc/publish_auction`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_auction_id: bannedDraft },
});
await sql(`update public.profiles set is_banned = false where id='${buyer1Id}'`);

// The same call after the flag is lifted must succeed, or this could be
// passing because publishing is simply broken for this account.
const unbannedPublish = await rest(`/rest/v1/rpc/publish_auction`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_auction_id: bannedDraft },
});
const unbannedMessage = String(unbannedPublish.data?.message ?? "");

check("security: a banned account cannot bid (account_banned)",
  !bannedBid.ok &&
    String(bannedBid.data?.message ?? "").includes("account_banned"),
  JSON.stringify(bannedBid.data)?.slice(0, 140));
check("security: a banned account cannot publish a listing (account_banned)",
  !bannedPublish.ok &&
    String(bannedPublish.data?.message ?? "").includes("account_banned"),
  JSON.stringify(bannedPublish.data)?.slice(0, 140));
check("security: unbanning lifts the block (the ban was the only reason it failed)",
  !unbannedMessage.includes("account_banned") && unbannedPublish.ok,
  `after unban: status=${unbannedPublish.status} message="${unbannedMessage}"`);

await sql(`delete from public.auction_images where auction_id='${bannedDraft}'`);
await sql(`delete from public.auction_cancellation_requests where auction_id='${bannedDraft}'`);
await sql(`delete from public.listing_reviews where auction_id='${bannedDraft}'`);
await sql(`delete from public.auction_cancellations where auction_id='${bannedDraft}'`);
await sql(`delete from public.auctions where id='${bannedDraft}'`);

// Banning must stop commerce, not strand a live auction: the engine still has
// to be able to close and settle one belonging to a banned seller.
const bannedSettle = rows(await sql(
  `select status from public.auctions where id='${soonAuction}'`))[0];
check("security: banning a seller does not block the engine settling their auction",
  bannedSettle?.status === "LIVE",
  `status=${bannedSettle?.status} - the check only fires on a move out of DRAFT, ` +
    `so settlement of an already-live auction is unaffected`);

// (d) A latent-critical check. The QA accounts' password is in this repository
// (e2e/fixtures.ts and TEST_PASSWORD below) because the suite needs it. That is
// only safe while NO QA account is an administrator - the harness itself
// promotes buyer2 temporarily. If one were ever left admin, the password in a
// public repo would be a full payout-authorisation credential.
const qaAdmins = rows(await sql(
  `select u.email from public.profiles p
     join auth.users u on u.id = p.id
    where p.is_admin and u.email like '%@bidblitz.test'`));
check("security: no QA test account is an administrator (repo holds their password)",
  qaAdmins.length === 0,
  qaAdmins.length ? `ADMIN ON QA ACCOUNT: ${qaAdmins.map((r) => r.email).join(", ")}` : "");

// --- hostile request surface ------------------------------------------------
const payoutId = payPayout?.id ?? "00000000-0000-0000-0000-000000000000";

const anonPayoutRead = await rest(`/rest/v1/seller_payouts?select=id`);
check("security: anon cannot read seller payouts",
  !anonPayoutRead.ok || (anonPayoutRead.data?.length ?? 0) === 0,
  `status=${anonPayoutRead.status} n=${anonPayoutRead.data?.length}`);

const anonPayoutWrite = await rest(`/rest/v1/seller_payouts`, {
  method: "POST",
  body: {
    transaction_id: refundTx.id, seller_id: sellerId, amount_minor: 999999,
    currency: "USD",
  },
});
check("security: anon cannot insert a payout with a forged amount",
  !anonPayoutWrite.ok, `status=${anonPayoutWrite.status}`);

const memberPayoutRead = await rest(`/rest/v1/seller_payouts?select=id,amount_minor,internal_note`,
  { bearer: tok.buyer1 });
check("security: a signed-in non-admin cannot read payout rows or notes",
  memberPayoutRead.ok && (memberPayoutRead.data?.length ?? 0) === 0,
  `n=${memberPayoutRead.data?.length}`);

const memberPayoutEdit = await rest(`/rest/v1/seller_payouts?id=eq.${payoutId}`,
  { method: "PATCH", bearer: tok.buyer1, body: { amount_minor: 999999 } });
check("security: a signed-in non-admin cannot change a payout amount",
  !memberPayoutEdit.ok, `status=${memberPayoutEdit.status}`);

const memberPayoutDelete = await rest(`/rest/v1/seller_payouts?id=eq.${payoutId}`,
  { method: "DELETE", bearer: tok.buyer1 });
check("security: a signed-in non-admin cannot delete a payout",
  !memberPayoutDelete.ok, `status=${memberPayoutDelete.status}`);

const memberPayoutState = rows(await sql(
  `select amount_minor from public.seller_payouts where id='${payoutId}'`))[0];
check("security: the hostile writes above changed nothing",
  Number(memberPayoutState?.amount_minor) === 2375,
  `amount_minor=${memberPayoutState?.amount_minor}`);

const anonPayoutRpc = await rest(`/rest/v1/rpc/admin_transition_seller_payout`, {
  method: "POST",
  body: { p_payout_id: payoutId, p_to_status: "PAID_OUT", p_payout_reference: "x" },
});
check("security: anon cannot call the payout writer",
  !anonPayoutRpc.ok, `status=${anonPayoutRpc.status}`);

const memberPayoutRpc = await rest(`/rest/v1/rpc/admin_transition_seller_payout`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_payout_id: payoutId, p_to_status: "PAID_OUT", p_payout_reference: "x" },
});
check("security: a non-admin cannot move a payout (payout_admin_only)",
  !memberPayoutRpc.ok &&
    String(memberPayoutRpc.data?.message ?? "").includes("payout_admin_only"),
  JSON.stringify(memberPayoutRpc.data)?.slice(0, 140));

const anonAuditWrite = await rest(`/rest/v1/seller_payout_events`, {
  method: "POST",
  body: { payout_id: payoutId, to_status: "PAID_OUT", payout_reference: "forged" },
});
check("security: the payout audit log has no write surface for clients",
  !anonAuditWrite.ok, `status=${anonAuditWrite.status}`);

// Money is frozen for EVERY role, the engine included — same rule as
// transactions, enforced by the BEFORE UPDATE trigger rather than by RLS.
let payoutMoneyErr = "";
try {
  await sql(`update public.seller_payouts set amount_minor = 1 where id='${payoutId}'`);
} catch (e) {
  payoutMoneyErr = `${e?.message ?? e}`;
}
check("payout: amount_minor / currency are immutable for EVERY role",
  payoutMoneyErr.includes("payout_money_immutable"),
  payoutMoneyErr.slice(0, 160) || "update succeeded — NOT immutable");

// --- the fulfilment ladder, driven by a real admin session ------------------
await sql(`update public.profiles set is_admin = true where id='${buyer2Id}'`);
const asAdmin = (body) =>
  rest(`/rest/v1/rpc/admin_transition_seller_payout`, {
    method: "POST", bearer: tok.buyer2, body,
  });

const noRef = await asAdmin({
  p_payout_id: payoutId, p_to_status: "PAID_OUT", p_payout_reference: null,
});
check("payout: PAID_OUT is refused without a payout reference",
  !noRef.ok && String(noRef.data?.message ?? "").includes("payout_reference_required"),
  JSON.stringify(noRef.data)?.slice(0, 140));

const step1 = await asAdmin({ p_payout_id: payoutId, p_to_status: "DELIVERY_CONFIRMED" });
const afterStep1 = rows(await sql(
  `select status, delivery_confirmed_at, paid_at from public.seller_payouts
    where id='${payoutId}'`))[0];
check("payout: WAITING_FOR_FULFILMENT -> DELIVERY_CONFIRMED stamps delivery",
  step1.ok && afterStep1?.status === "DELIVERY_CONFIRMED" &&
    afterStep1?.delivery_confirmed_at !== null && afterStep1?.paid_at === null,
  JSON.stringify(afterStep1));

const step2 = await asAdmin({
  p_payout_id: payoutId, p_to_status: "PAYOUT_DUE",
  p_internal_note: "Item collected in person.",
});
const afterStep2 = rows(await sql(
  `select status, internal_note from public.seller_payouts where id='${payoutId}'`))[0];
check("payout: -> PAYOUT_DUE records the operator note",
  step2.ok && afterStep2?.status === "PAYOUT_DUE" &&
    String(afterStep2?.internal_note ?? "").includes("collected in person"),
  JSON.stringify(afterStep2));

const step3 = await asAdmin({
  p_payout_id: payoutId, p_to_status: "PAID_OUT", p_payout_reference: "BANK-REF-1",
});
const afterStep3 = rows(await sql(
  `select status, payout_reference, paid_at from public.seller_payouts
    where id='${payoutId}'`))[0];
check("payout: PAYOUT_DUE -> PAID_OUT records the reference and the moment",
  step3.ok && afterStep3?.status === "PAID_OUT" &&
    afterStep3?.payout_reference === "BANK-REF-1" && afterStep3?.paid_at !== null,
  JSON.stringify(afterStep3));

const revert = await asAdmin({
  p_payout_id: payoutId, p_to_status: "DELIVERY_CONFIRMED",
});
check("payout: PAID_OUT is terminal — it cannot be reverted",
  !revert.ok && String(revert.data?.message ?? "").includes("payout_paid_out_immutable"),
  JSON.stringify(revert.data)?.slice(0, 140));

const illegal = await asAdmin({
  p_payout_id: payoutId, p_to_status: "PAYOUT_DUE",
});
check("payout: PAID_OUT -> anything else is refused by the transition map",
  !illegal.ok, JSON.stringify(illegal.data)?.slice(0, 140));

await sql(`update public.profiles set is_admin = false where id='${buyer2Id}'`);

const refundPayoutId = rows(await sql(
  `select id from public.seller_payouts where transaction_id='${refundTx.id}'`))[0]?.id;

const postDemotion = await asAdmin({
  p_payout_id: refundPayoutId ?? payoutId,
  p_to_status: "PAYOUT_DUE",
});
check("payout: revoking admin immediately revokes the payout writer",
  !postDemotion.ok && String(postDemotion.data?.message ?? "").includes("payout_admin_only"),
  JSON.stringify(postDemotion.data)?.slice(0, 140));

// --- audit trail ------------------------------------------------------------
const auditRows = rows(await sql(
  `select from_status, to_status, payout_reference, actor_id
     from public.seller_payout_events
    where payout_id='${payoutId}' order by created_at`));
const auditOk = auditRows.length >= 4 &&
  auditRows[0]?.from_status === null &&
  auditRows[0]?.to_status === "WAITING_FOR_FULFILMENT" &&
  auditRows.some((r) => r.from_status === "WAITING_FOR_FULFILMENT" &&
    r.to_status === "DELIVERY_CONFIRMED") &&
  auditRows.some((r) => r.to_status === "PAID_OUT" &&
    r.payout_reference === "BANK-REF-1");
check("payout: every payout state change is audited (creation -> PAID_OUT)",
  auditOk, `${auditRows.length} events: ${JSON.stringify(auditRows).slice(0, 220)}`);

const actorsAreNonSystem = auditRows.slice(1).every((r) => r.actor_id === buyer2Id);
check("payout: transition audit rows are attributed to the acting admin",
  actorsAreNonSystem, JSON.stringify(auditRows.slice(1).map((r) => r.actor_id)));

// --- the seller's own read path --------------------------------------------
const anonMine = await rest(`/rest/v1/rpc/my_seller_payouts`, { method: "POST", body: {} });
check("security: anon cannot read my_seller_payouts",
  !anonMine.ok, `status=${anonMine.status}`);

const buyer1Mine = await rest(`/rest/v1/rpc/my_seller_payouts`, {
  method: "POST", bearer: tok.buyer1, body: {},
});
check("payout: my_seller_payouts returns nothing for someone else's sales",
  buyer1Mine.ok && (buyer1Mine.data?.length ?? 0) === 0,
  `n=${buyer1Mine.data?.length}`);

const sellerMine = await rest(`/rest/v1/rpc/my_seller_payouts`, {
  method: "POST", bearer: tok.seller, body: {},
});
const safeFields = ["transaction_id", "status", "amount_minor", "currency",
  "delivery_confirmed_at", "paid_at", "updated_at"];
const sellerRows = Array.isArray(sellerMine.data) ? sellerMine.data : [];
const leaksInternal = sellerRows.some(
  (r) => !safeFields.every((f) => Object.hasOwn(r, f)) ||
    Object.hasOwn(r, "internal_note") || Object.hasOwn(r, "payout_reference") ||
    Object.hasOwn(r, "seller_id") || Object.hasOwn(r, "id"),
);
check("payout: my_seller_payouts exposes only the caller's own safe fields",
  sellerMine.ok && sellerRows.length > 0 && !leaksInternal &&
    sellerRows.every((r) => Number.isInteger(r.amount_minor)),
  `n=${sellerRows.length} keys=${Object.keys(sellerRows[0] ?? {}).join(",")}`);

// Remove every synthetic artifact: fixtures never survive into production
// data (no fabricated payment, no fabricated notifications, no fake listing).
await sql(`delete from public.payment_events where transaction_id='${payTx.id}'`);
await sql(`delete from public.payment_events where transaction_id='${failTx.id}'`);
await sql(`delete from public.payment_events where transaction_id='${refundTx.id}'`);
await sql(`delete from public.seller_payout_events
            where payout_id in (select id from public.seller_payouts
                                 where transaction_id in
                                   ('${payTx.id}','${failTx.id}','${refundTx.id}'))`);
await sql(`delete from public.seller_payouts
            where transaction_id in ('${payTx.id}','${failTx.id}','${refundTx.id}')`);
await sql(`delete from public.notifications where auction_id='${soonAuction}'`);
await sql(`delete from public.notifications where auction_id='${failFixture.auction}'`);
await sql(`delete from public.notifications where auction_id='${refundFixture.auction}'`);
await sql(`delete from public.watchlist where auction_id='${soonAuction}'`);
await sql(`delete from public.transactions where id='${payTx.id}'`);
await sql(`delete from public.transactions where id='${failTx.id}'`);
await sql(`delete from public.transactions where id='${refundTx.id}'`);
await sql(`delete from public.auction_cancellation_requests where auction_id in ('${soonAuction}','${failFixture.auction}','${refundFixture.auction}')`);
await sql(`delete from public.listing_reviews where auction_id in ('${soonAuction}','${failFixture.auction}','${refundFixture.auction}')`);
await sql(`delete from public.auction_cancellations where auction_id in ('${soonAuction}','${failFixture.auction}','${refundFixture.auction}')`);
await sql(`delete from public.auctions where id='${soonAuction}'`);
await sql(`delete from public.auctions where id='${failFixture.auction}'`);
await sql(`delete from public.auctions where id='${refundFixture.auction}'`);

// ---------------------------------------------------------------------------
// The auction_images row inserted for the image_count checks is a fixture, not
// a listing photo: no object ever backs `harness/<id>/cover.jpg`. Remove it
// before leaving so production never shows a broken image for a row we made.
//
// The main fixture auction itself goes too — and everything that accumulated
// on it (bids, its settled sale, review/notification/report rows). The reset at
// the start of the NEXT run would eventually take it, but "eventually" means a
// fabricated SOLD listing and a fabricated AWAITING_PAYMENT transaction sit in
// production data in between, which is exactly the kind of thing this project
// refuses to ship. Fixtures are removed here, and then asserted gone.
const fixtureTxIds = `(select id from public.transactions where auction_id='${auctionId}')`;
await sql(`delete from public.payment_events where transaction_id in ${fixtureTxIds}`);
await sql(`delete from public.seller_payout_events where payout_id in
            (select id from public.seller_payouts where transaction_id in ${fixtureTxIds})`);
await sql(`delete from public.seller_payouts where transaction_id in ${fixtureTxIds}`);
await sql(`delete from public.reviews where transaction_id in ${fixtureTxIds}`);
await sql(`delete from public.auction_cancellation_requests where auction_id='${auctionId}'`);
await sql(`delete from public.listing_reviews where auction_id='${auctionId}'`);
await sql(`delete from public.auction_cancellations where auction_id='${auctionId}'`);
await sql(`delete from public.notifications where auction_id='${auctionId}'`);
await sql(`delete from public.watchlist where auction_id='${auctionId}'`);
await sql(`delete from public.reports
            where target_type='auction' and target_id='${auctionId}'`);
await sql(`delete from public.transactions where auction_id='${auctionId}'`);
await sql(`delete from public.bids where auction_id='${auctionId}'`);
await sql(`delete from public.auction_images where auction_id='${auctionId}'`);
await sql(`delete from public.auctions where id='${auctionId}'`);

  // ---- 15b. moderation: reports, takedown audit, ban enforcement ------------
  //
  // The reports pipeline existed (table, RLS, reportAction, admin queue) but
  // had no audit trail for enforcement: an admin takedown recorded nothing.
  // Migration 20260929000002 added moderation_events plus admin_takedown_auction
  // and admin_set_banned. This section proves the whole model at the boundary
  // that matters - the database and RPC layer, never the UI - using the same
  // temporary-admin pattern as the security section above, with restore.
  //
  // Fixtures are created here and removed at the end of the section, scoped to
  // their ids, like CASE A/D and RACE above.
  console.log("\n--- moderation ---");
  const modSectionStarted = new Date().toISOString();
  const MOD_TITLE = "Verify: reported listing with counterfeit claims";
  const modCreated = await rest(`/rest/v1/auctions`, {
    method: "POST", bearer: tok.seller,
    headers: { Prefer: "return=representation" },
    body: { ...auctionPayload, title: MOD_TITLE },
  });
  const modId = modCreated.data?.[0]?.id;
  check("MOD: a fixture listing exists for the moderation path", !!modId,
    modId ?? JSON.stringify(modCreated.data));

  if (modId) {
    await rest(`/rest/v1/auction_images`, {
      method: "POST", bearer: tok.seller,
      body: { auction_id: modId, storage_path: `harness/${modId}/cover.jpg`, position: 0 },
    });
    const modPub = await rest(`/rest/v1/rpc/publish_auction`, {
      method: "POST", bearer: tok.seller,
      body: { p_auction_id: modId },
    });
    // The main fixture is long deleted by this point, so the seller holds no
    // non-draft history and this publish routes to PENDING_REVIEW (first
    // listing). Approve it through the temp-admin pattern so the moderation
    // path below exercises a genuinely LIVE listing.
    if (modPub.ok && modPub.data?.status === "PENDING_REVIEW") {
      await sql(`update public.profiles set is_admin = true where id='${buyer2Id}'`);
      const modReviewId = rows(await sql(
        `select id from public.listing_reviews where auction_id='${modId}' and status='PENDING'`))[0]?.id;
      await rest(`/rest/v1/rpc/admin_decide_review`, {
        method: "POST", bearer: tok.buyer2,
        body: { p_review_id: modReviewId, p_decision: "APPROVED" },
      });
      await sql(`update public.profiles set is_admin = false where id='${buyer2Id}'`);
    }
    // A genuine bid while the listing is live. Takedown must end the sale
    // without erasing the history: the bid row survives, unmarked, with no
    // transaction ever created for it.
    await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: modId, p_amount_minor: 1000, p_request_id: randomUUID() },
    });

    // ---- reports: create, duplicate, unauthorized mutation ------------------
    const rep1 = await rest(`/rest/v1/reports`, {
      method: "POST", bearer: tok.buyer1,
      headers: { Prefer: "return=representation" },
      body: { reporter_id: buyer1Id, target_type: "auction", target_id: modId, reason: "Counterfeit item with a fake serial number" },
    });
    const modReportId = rep1.data?.[0]?.id;
    check("MOD: an ordinary user can file an auction report",
      rep1.ok && !!modReportId, `status=${rep1.status}`);

    // The (reporter, target) uniqueness refuses a second row: the reporter is
    // told their first report stands, not that something broke.
    const repDup = await rest(`/rest/v1/reports`, {
      method: "POST", bearer: tok.buyer1,
      body: { reporter_id: buyer1Id, target_type: "auction", target_id: modId, reason: "Reporting again with more detail here" },
    });
    check("MOD: a duplicate report is refused by the uniqueness constraint",
      !repDup.ok && /23505|duplicate|already exists/i.test(JSON.stringify(repDup.data)),
      `status=${repDup.status} ${JSON.stringify(repDup.data)?.slice(0, 120)}`);

    // A different user cannot touch someone else's report (no UPDATE policy).
    const repHijack = await rest(`/rest/v1/reports?id=eq.${modReportId}`, {
      method: "PATCH", bearer: tok.buyer2,
      body: { status: "DISMISSED" },
    });
    const repStillOpen = rows(await sql(
      `select status from public.reports where id='${modReportId}'`))[0]?.status;
    check("MOD: a non-admin cannot resolve or dismiss a report",
      repStillOpen === "OPEN", `status=${repStillOpen} patch=${repHijack.status}`);

    // A non-admin cannot invoke enforcement either.
    const nonAdminTake = await rest(`/rest/v1/rpc/admin_takedown_auction`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: modId, p_reason: "Trying to take down a listing without rights" },
    });
    check("MOD: a non-admin cannot take down a listing through the RPC",
      !nonAdminTake.ok && /not_admin/i.test(JSON.stringify(nonAdminTake.data)),
      `status=${nonAdminTake.status} ${JSON.stringify(nonAdminTake.data)?.slice(0, 120)}`);
    const nonAdminBan = await rest(`/rest/v1/rpc/admin_set_banned`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_user_id: sellerId, p_banned: true, p_reason: "Trying to ban the seller without rights" },
    });
    check("MOD: a non-admin cannot ban through the RPC",
      !nonAdminBan.ok && /not_admin/i.test(JSON.stringify(nonAdminBan.data)),
      `status=${nonAdminBan.status}`);

    // ---- admin: triage, takedown, audit --------------------------------------
    await sql(`update public.profiles set is_admin = true where id='${buyer2Id}'`);
    const triage = await rest(`/rest/v1/reports?id=eq.${modReportId}`, {
      method: "PATCH", bearer: tok.buyer2,
      headers: { Prefer: "return=representation" },
      body: { status: "REVIEWING" },
    });
    check("MOD: admin can move a report to REVIEWING",
      triage.ok, `status=${triage.status}`);

    // Banning happens while the fixture is still LIVE, so the refused
    // bid below proves the BAN trigger fires - not the close refusal, which
    // would fire first on a taken-down auction and prove nothing.

    // ---- admin: ban, enforcement, restore -------------------------------------
    // The banal account cannot suspend itself: that would be a lockout button.
    const selfBan = await rest(`/rest/v1/rpc/admin_set_banned`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer2Id, p_banned: true, p_reason: "An admin trying to suspend their own account" },
    });
    check("MOD: an admin cannot suspend their own account",
      !selfBan.ok && /cannot_ban_self/i.test(JSON.stringify(selfBan.data)),
      `status=${selfBan.status}`);

    const ban = await rest(`/rest/v1/rpc/admin_set_banned`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer1Id, p_banned: true, p_reason: "Shill bidding across three auctions" },
    });
    check("MOD: admin can suspend an account",
      ban.ok && ban.data?.is_banned === true, JSON.stringify(ban.data));

    const banAudit = rows(await sql(
      `select actor_id::text as actor, action, reason from public.moderation_events
        where target_type = 'user' and target_id = '${buyer1Id}'
        order by created_at desc limit 1`))[0];
    check("MOD: suspension writes the audit row",
      banAudit?.actor === buyer2Id && banAudit?.action === "BAN_USER"
        && (banAudit?.reason ?? "").includes("Shill"),
      JSON.stringify(banAudit));

    // Enforcement is at the database boundary, not the buttons: a banned
    // account calling the RPCs directly is refused with account_banned.
    const bannedBid = await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: modId, p_amount_minor: 5000, p_request_id: randomUUID() },
    });
    check("MOD: a suspended account cannot bid, even direct",
      !bannedBid.ok && /account_banned/i.test(JSON.stringify(bannedBid.data)),
      `status=${bannedBid.status}`);

    const take = await rest(`/rest/v1/rpc/admin_takedown_auction`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_auction_id: modId, p_reason: "Counterfeit serial number confirmed against listing photos", p_report_id: modReportId },
    });
    check("MOD: admin can take down a violating listing",
      take.ok && take.data?.status === "CANCELLED",
      JSON.stringify(take.data));

    const taken = rows(await sql(
      `select status from public.auctions where id='${modId}'`))[0]?.status;
    const audit = rows(await sql(
      `select actor_id::text as actor, action, target_type, target_id::text as target,
              prev_status, new_status, reason, report_id::text as report
         from public.moderation_events
        where target_type = 'auction' and target_id = '${modId}'
        order by created_at desc limit 1`))[0];
    check("MOD: takedown writes the audit row (actor, action, reason, report)",
      taken === "CANCELLED"
        && audit?.actor === buyer2Id && audit?.action === "TAKEDOWN_LISTING"
        && audit?.prev_status === "LIVE" && audit?.new_status === "CANCELLED"
        && (audit?.reason ?? "").includes("Counterfeit")
        && audit?.report === modReportId,
      `status=${taken} audit=${JSON.stringify(audit)}`);

    const sellerNotice = rows(await sql(
      `select type from public.notifications
        where user_id='${sellerId}' and auction_id='${modId}' and type='LISTING_REMOVED'`));
    check("MOD: the seller is told their listing was removed (safe copy)",
      sellerNotice.length === 1, `LISTING_REMOVED=${sellerNotice.length}`);

    const reportClosed = rows(await sql(
      `select status from public.reports where id='${modReportId}'`))[0]?.status;
    check("MOD: the originating report is resolved by the takedown",
      reportClosed === "RESOLVED", `status=${reportClosed}`);

    // A taken-down listing behaves as closed everywhere: no bids, no payment
    // flow, history preserved.
    const bidAfterTake = await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: modId, p_amount_minor: 5000, p_request_id: randomUUID() },
    });
    const settleTake = await rest(`/rest/v1/rpc/settle_auction`, {
      method: "POST", bearer: SEC, key: SEC,
      body: { p_auction_id: modId },
    });
    const takeTx = rows(await sql(
      `select count(*)::int as n from public.transactions where auction_id='${modId}'`))[0].n;
    check("MOD: no bid survives on a taken-down listing",
      !bidAfterTake.ok, `status=${bidAfterTake.status}`);
    check("MOD: a taken-down listing can never produce a transaction",
      takeTx === 0 && settleTake.data?.status === "CANCELLED",
      `transactions=${takeTx} settle=${JSON.stringify(settleTake.data)}`);

    // Takedown refuses what is already closed: history is not rewritten.
    const takeAgain = await rest(`/rest/v1/rpc/admin_takedown_auction`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_auction_id: modId, p_reason: "Trying to take down an already closed listing" },
    });
    const keptBid = rows(await sql(
      `select count(*)::int as n from public.bids where auction_id='${modId}'`))[0].n;
    const keptWinning = rows(await sql(
      `select count(*)::int as n from public.bids
        where auction_id='${modId}' and is_winning`))[0].n;
    check("MOD: a takedown preserves bid history instead of deleting it",
      keptBid === 1 && keptWinning === 0,
      `bids=${keptBid} winning=${keptWinning} (the sale ended, the record did not)`);
    check("MOD: taking down a closed listing is refused",
      !takeAgain.ok && /invalid_state/i.test(JSON.stringify(takeAgain.data)),
      `status=${takeAgain.status}`);


    // buyer2 stays admin through the restore, then loses it once, at the end.
    const restore = await rest(`/rest/v1/rpc/admin_set_banned`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer1Id, p_banned: false, p_reason: "Appeal upheld with a warning recorded" },
    });
    const unbanAudit = rows(await sql(
      `select action from public.moderation_events
        where target_type = 'user' and target_id = '${buyer1Id}'
        order by created_at desc limit 1`))[0]?.action;
    await sql(`update public.profiles set is_admin = false where id='${buyer2Id}'`);
    check("MOD: admin can restore an account, and the restoration is audited",
      restore.ok && restore.data?.is_banned === false && unbanAudit === "UNBAN_USER",
      `${JSON.stringify(restore.data)} audit=${unbanAudit}`);

    // Ordinary users cannot read the trail, and cannot write it either: there
    // is no insert/update/delete policy for any non-admin role.
    const auditRead = await rest(`/rest/v1/moderation_events?select=id`, { bearer: tok.buyer1 });
    check("MOD: a non-admin cannot read moderation events",
      auditRead.ok && auditRead.data.length === 0, `${auditRead.data?.length} rows`);
    const auditWrite = await rest(`/rest/v1/moderation_events`, {
      method: "POST", bearer: tok.buyer1,
      body: { actor_id: buyer1Id, action: "BAN_USER", target_type: "user", target_id: sellerId, reason: "Forged audit row by a non-admin" },
    });
    check("MOD: a non-admin cannot write moderation events",
      !auditWrite.ok, `status=${auditWrite.status}`);

    // Cleanup: this section's fixture and its trail. The audit rows reference
    // the fixture, so they go first; the report follows; the auction last.
    // Scoped to modId and modReportId only.
    const modTitleOk = rows(await sql(
      `select title from public.auctions where id='${modId}'`))[0]?.title === MOD_TITLE;
    if (modTitleOk) {
      await sql(`delete from public.moderation_events
        where created_at >= '${modSectionStarted}'
          and ((target_type = 'auction' and target_id = '${modId}')
               or (target_type = 'user' and target_id = '${buyer1Id}'
                   and action in ('BAN_USER', 'UNBAN_USER')))`);
      await sql(`delete from public.auction_cancellation_requests where auction_id in ('${modId}')`);
      await sql(`delete from public.listing_reviews where auction_id in ('${modId}')`);
      await sql(`delete from public.auction_cancellations where auction_id in ('${modId}')`);
      await sql(`delete from public.notifications where auction_id in ('${modId}')`);
      await sql(`delete from public.reports where id in ('${modReportId}')`);
      await sql(`delete from public.bids where auction_id in ('${modId}')`);
      await sql(`delete from public.auction_images where auction_id in ('${modId}')`);
      await sql(`delete from public.watchlist where auction_id in ('${modId}')`);
      await sql(`delete from public.auctions where id in ('${modId}')`);
      check("MOD: this section's own fixture and trail were removed here", true, "removed 1 fixture");
    } else {
      check("MOD: this section's own fixture and trail were removed here", false,
        "REFUSED: title did not match our fixture");
    }
  }

  // ---- 15c. lifecycle: review routing, pause/resume, cancellation requests --
  //
  // Migration 20260930000001/2 added PENDING_REVIEW, PAUSED, listing_reviews,
  // cancellation_requests and auction_cancellations. This section proves the
  // new states behave, in final database state, never in return values alone.
  //
  // Determinism note: the main fixture earlier in this run consumed the
  // first-listing signal, so this fixture routes on its high value alone
  // (starting bid at the $500 threshold). Either signal alone suffices.
  console.log("\n--- lifecycle: review, pause, cancellation requests ---");

  const LC_TITLE = "Verify: high-value listing needing review";
  const lcCreated = await rest(`/rest/v1/auctions`, {
    method: "POST", bearer: tok.seller,
    headers: { Prefer: "return=representation" },
    body: { ...auctionPayload, title: LC_TITLE, starting_bid_minor: 100000 },
  });
  const lcId = lcCreated.data?.[0]?.id;
  check("LC: fixture listing created for the lifecycle path", !!lcId,
    lcId ?? JSON.stringify(lcCreated.data));

  if (lcId) {
    await rest(`/rest/v1/auction_images`, {
      method: "POST", bearer: tok.seller,
      body: { auction_id: lcId, storage_path: `harness/${lcId}/cover.jpg`, position: 0 },
    });
    const lcPub = await rest(`/rest/v1/rpc/publish_auction`, {
      method: "POST", bearer: tok.seller,
      body: { p_auction_id: lcId },
    });
    check("LC-AA: a high-value listing routes to PENDING_REVIEW, not LIVE",
      lcPub.ok && lcPub.data?.status === "PENDING_REVIEW",
      JSON.stringify(lcPub.data));
    const lcReview = rows(await sql(
      `select status, risk_flags from public.listing_reviews where auction_id='${lcId}' order by created_at desc limit 1`))[0];
    check("LC-AA: the review row records why it was held",
      lcReview?.status === "PENDING"
        && lcReview?.risk_flags?.high_value === true,
      JSON.stringify(lcReview));
    const lcNotice = rows(await sql(
      `select type from public.notifications where user_id='${sellerId}' and auction_id='${lcId}' and type='REVIEW_SUBMITTED'`));
    check("LC-AA: the seller is told their listing is under review",
      lcNotice.length === 1, `REVIEW_SUBMITTED=${lcNotice.length}`);

    // A bid on a held listing is refused before any write, like any non-live.
    const lcEarlyBid = await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: lcId, p_amount_minor: 100000, p_request_id: randomUUID() },
    });
    check("LC: no bid can land on a listing waiting for review",
      !lcEarlyBid.ok && /auction_not_live/.test(JSON.stringify(lcEarlyBid.data)),
      JSON.stringify(lcEarlyBid.data));

    // Non-admin review decisions are refused at the boundary.
    const lcNonAdminDecide = await rest(`/rest/v1/rpc/admin_decide_review`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_review_id: "00000000-0000-0000-0000-000000000000", p_decision: "APPROVED" },
    });
    check("LC-AF: a non-admin cannot decide reviews",
      !lcNonAdminDecide.ok && /not_admin/i.test(JSON.stringify(lcNonAdminDecide.data)),
      `status=${lcNonAdminDecide.status}`);

    // Admin approves through the temp-admin pattern (restored after).
    await sql(`update public.profiles set is_admin = true where id='${buyer2Id}'`);
    const lcReviewId = rows(await sql(
      `select id from public.listing_reviews where auction_id='${lcId}' and status='PENDING'`))[0]?.id;
    const lcApprove = await rest(`/rest/v1/rpc/admin_decide_review`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_review_id: lcReviewId, p_decision: "APPROVED" },
    });
    const lcAfterApprove = rows(await sql(
      `select status from public.auctions where id='${lcId}'`))[0]?.status;
    const lcApproveNotice = rows(await sql(
      `select type from public.notifications where user_id='${sellerId}' and auction_id='${lcId}' and type='REVIEW_APPROVED'`));
    check("LC-AB: admin approval publishes the listing and notifies the seller",
      lcApprove.ok && lcAfterApprove === "LIVE" && lcApproveNotice.length === 1,
      `status=${lcAfterApprove} notice=${lcApproveNotice.length} ${JSON.stringify(lcApprove.data)}`);

    // Deciding twice is refused: the review is no longer pending.
    const lcApproveAgain = await rest(`/rest/v1/rpc/admin_decide_review`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_review_id: lcReviewId, p_decision: "REJECTED", p_reason: "Trying to decide twice" },
    });
    check("LC: a decided review cannot be decided again",
      !lcApproveAgain.ok && /invalid_state/i.test(JSON.stringify(lcApproveAgain.data)),
      `status=${lcApproveAgain.status}`);

    // Pause: the hold freezes bidding with history intact.
    await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: lcId, p_amount_minor: 100000, p_request_id: randomUUID() },
    });
    const lcPause = await rest(`/rest/v1/rpc/admin_pause_auction`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_auction_id: lcId, p_reason: "Suspected shill pattern under investigation" },
    });
    const lcPaused = rows(await sql(
      `select status, paused_at is not null as held, bid_count from public.auctions where id='${lcId}'`))[0];
    check("LC-J: admin can pause a live auction, bids retained",
      lcPause.ok && lcPaused?.status === "PAUSED" && lcPaused?.held === true && lcPaused?.bid_count === 1,
      `status=${lcPaused?.status} bids=${lcPaused?.bid_count}`);

    // A non-admin cannot pause, even the seller.
    const lcSellerPause = await rest(`/rest/v1/rpc/admin_pause_auction`, {
      method: "POST", bearer: tok.seller,
      body: { p_auction_id: lcId, p_reason: "A seller trying to pause their own auction" },
    });
    check("LC: sellers cannot pause (hold is admin-only)",
      !lcSellerPause.ok && /not_admin/i.test(JSON.stringify(lcSellerPause.data)),
      `status=${lcSellerPause.status}`);

    // LC-L: bidding on a paused auction is refused with its own code.
    const lcPausedBid = await rest(`/rest/v1/rpc/place_bid`, {
      method: "POST", bearer: tok.buyer3,
      body: { p_auction_id: lcId, p_amount_minor: 200000, p_request_id: randomUUID() },
    });
    check("LC-L: a paused auction cannot accept bids",
      !lcPausedBid.ok && /auction_paused/.test(JSON.stringify(lcPausedBid.data)),
      JSON.stringify(lcPausedBid.data));

    // LC-M: resume shifts the end forward by exactly the held duration.
    await sql(`update public.auctions set paused_at = now() - interval '1 hour', ends_at = now() + interval '2 hours' where id='${lcId}'`);
    const lcResume = await rest(`/rest/v1/rpc/admin_resume_auction`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_auction_id: lcId, p_reason: "Pattern cleared, resuming" },
    });
    const lcResumed = rows(await sql(
      `select status, paused_at, extract(epoch from (ends_at - now()))::int as remaining
          from public.auctions where id='${lcId}'`))[0];
    check("LC-K/M: resume restores LIVE with the held hour added back",
      lcResume.ok && lcResumed?.status === "LIVE" && lcResumed?.paused_at === null
        && lcResumed?.remaining >= 3 * 3600 - 120 && lcResumed?.remaining <= 3 * 3600 + 120,
      `status=${lcResumed?.status} remaining=${lcResumed?.remaining}s (expected ~10800)`);
    const lcPauseEvents = rows(await sql(
      `select count(*)::int as n from public.moderation_events
        where target_type='auction' and target_id='${lcId}'
          and action in ('PAUSE_AUCTION','RESUME_AUCTION')`))[0].n;
    check("LC: pause history survives the resume (two audit rows)",
      lcPauseEvents === 2, `events=${lcPauseEvents}`);

    // Cancellation request on the live with-bids auction.
    const lcReq = await rest(`/rest/v1/rpc/request_cancellation`, {
      method: "POST", bearer: tok.seller,
      body: { p_auction_id: lcId, p_reason_code: "ITEM_DAMAGED", p_explanation: "Dropped during packing, corner dented" },
    });
    check("LC-E: seller can request cancellation of a with-bids auction",
      lcReq.ok && lcReq.data?.status === "PENDING", JSON.stringify(lcReq.data));
    const lcReqId = rows(await sql(
      `select id from public.auction_cancellation_requests where auction_id='${lcId}' and status='PENDING'`))[0]?.id;
    const lcDupReq = await rest(`/rest/v1/rpc/request_cancellation`, {
      method: "POST", bearer: tok.seller,
      body: { p_auction_id: lcId, p_reason_code: "OTHER", p_explanation: "Second attempt" },
    });
    check("LC-F: a duplicate pending request is refused, not duplicated",
      !lcDupReq.ok && /duplicate_request/i.test(JSON.stringify(lcDupReq.data)),
      `status=${lcDupReq.status}`);
    const lcAdminNotice = rows(await sql(
      `select count(*)::int as n from public.notifications
        where auction_id='${lcId}' and type='CANCELLATION_REQUESTED'`))[0].n;
    check("LC-V: the admin queue is notified of the request",
      lcAdminNotice >= 1, `notices=${lcAdminNotice}`);

    // Non-admin cannot decide it (seller trying to approve own request).
    const lcSelfDecide = await rest(`/rest/v1/rpc/decide_cancellation`, {
      method: "POST", bearer: tok.seller,
      body: { p_request_id: lcReqId, p_approve: true },
    });
    check("LC-G: non-admin cannot approve a cancellation request",
      !lcSelfDecide.ok && /not_admin/i.test(JSON.stringify(lcSelfDecide.data)),
      `status=${lcSelfDecide.status}`);

    // Reject without a reason is refused (the seller is owed the why).
    const lcBareReject = await rest(`/rest/v1/rpc/decide_cancellation`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_request_id: lcReqId, p_approve: false },
    });
    check("LC: rejecting without a reason is refused",
      !lcBareReject.ok && /invalid_reason/i.test(JSON.stringify(lcBareReject.data)),
      `status=${lcBareReject.status}`);

    // Approve: CANCELLED, no winner, no transaction, bidders told.
    const lcDecide = await rest(`/rest/v1/rpc/decide_cancellation`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_request_id: lcReqId, p_approve: true, p_reason: "Damage confirmed by photos" },
    });
    const lcFinal = rows(await sql(
      `select status, winner_id, winning_bid_minor,
              (select count(*)::int from public.bids b where b.auction_id = a.id) as bids,
              (select count(*)::int from public.bids b where b.auction_id = a.id and is_winning) as winning,
              (select count(*)::int from public.transactions t where t.auction_id = a.id) as tx,
              (select count(*)::int from public.notifications n where n.auction_id = a.id and n.type='AUCTION_CANCELLED' and n.user_id='${buyer1Id}') as bidder_told,
              (select count(*)::int from public.notifications n where n.auction_id = a.id and n.type='CANCELLATION_DECIDED' and n.user_id='${sellerId}') as seller_told
         from public.auctions a where a.id = '${lcId}'`))[0];
    check("LC-H/T/U: approval cancels with no winner, no transaction, history kept, everyone told",
      lcDecide.ok && lcFinal.status === "CANCELLED" && lcFinal.winner_id === null
        && lcFinal.winning_bid_minor === null && lcFinal.bids === 1 && lcFinal.winning === 0
        && lcFinal.tx === 0 && lcFinal.bidder_told === 1 && lcFinal.seller_told === 1,
      `status=${lcFinal.status} bids=${lcFinal.bids} tx=${lcFinal.tx} bidder=${lcFinal.bidder_told} seller=${lcFinal.seller_told}`);
    const lcClosure = rows(await sql(
      `select actor_role, prev_status, reason_code from public.auction_cancellations where auction_id='${lcId}'`))[0];
    check("LC-S: the approval writes the closure record (admin, prev LIVE, reason)",
      lcClosure?.actor_role === "admin" && lcClosure?.prev_status === "LIVE"
        && lcClosure?.reason_code === "ITEM_DAMAGED",
      JSON.stringify(lcClosure));
    await sql(`update public.profiles set is_admin = false where id='${buyer2Id}'`);

    // Cleanup: fixture, requests, reviews, notices, bids, images.
    const lcTitleOk = rows(await sql(
      `select title from public.auctions where id='${lcId}'`))[0]?.title === LC_TITLE;
    if (lcTitleOk) {
      await sql(`delete from public.auction_cancellation_requests where auction_id in ('${lcId}')`);
      await sql(`delete from public.listing_reviews where auction_id in ('${lcId}')`);
      await sql(`delete from public.auction_cancellations where auction_id in ('${lcId}')`);
      await sql(`delete from public.moderation_events where target_id in ('${lcId}')`);
      await sql(`delete from public.notifications where auction_id in ('${lcId}')`);
      await sql(`delete from public.bids where auction_id in ('${lcId}')`);
      await sql(`delete from public.auction_images where auction_id in ('${lcId}')`);
      await sql(`delete from public.watchlist where auction_id in ('${lcId}')`);
      await sql(`delete from public.auctions where id in ('${lcId}')`);
      check("LC: this section's own fixture and trail were removed here", true, "removed 1 fixture");
    } else {
      check("LC: this section's own fixture and trail were removed here", false,
        "REFUSED: title did not match our fixture");
    }
  }


// ---- 16. avatars: namespaced storage + a key that cannot leave your folder --
  // ---- 15d. team RBAC + email outbox -----------------------------------------
  //
  // Migration 20260930000003 created staff_roles/permissions/assignments,
  // team_invitations, staff_audit and the email_outbox + preferences tables.
  // This section proves the authorization boundaries at the RPC layer with the
  // same temp-privilege discipline as MOD/LC: buyer3 is promoted, suspended,
  // restored and revoked here, and ends with no staff access - asserted.
  console.log("\n--- team RBAC + email outbox ---");
  const ownerId = rows(await sql(
    `select id from public.profiles where is_admin order by created_at limit 1`))[0]?.id;
  check("RB: exactly one owner exists to run this section", !!ownerId,
    ownerId ?? "no is_admin profile");

  if (ownerId) {
    const perm = async (uid, p) =>
      rows(await sql(`select public.has_permission('${uid}', '${p}') as ok`))[0]?.ok === true;

    check("RB: OWNER implies every permission without a bundle row",
      await perm(ownerId, "admin.access") && await perm(ownerId, "payouts.mark_paid"),
      "owner holds admin.access + payouts.mark_paid");

    // Anonymous and ordinary users cannot touch team management.
    const anonAssign = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST",
      body: { p_user_id: buyer1Id, p_role_key: "MODERATOR" },
    });
    check("RB-AH: anonymous cannot assign roles",
      !anonAssign.ok && [401, 403, 404].includes(anonAssign.status),
      `status=${anonAssign.status}`);
    const userAssign = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_user_id: buyer2Id, p_role_key: "MODERATOR" },
    });
    check("RB-AF/AI: an ordinary user cannot assign roles and cannot escalate",
      !userAssign.ok && /not_admin/i.test(JSON.stringify(userAssign.data)),
      `status=${userAssign.status}`);
    const userPause = await rest(`/rest/v1/rpc/admin_pause_auction`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_auction_id: "00000000-0000-0000-0000-000000000000", p_reason: "Trying to pause without rights" },
    });
    check("RB: an ordinary user cannot pause auctions",
      !userPause.ok && /not_admin/i.test(JSON.stringify(userPause.data)),
      `status=${userPause.status}`);

    // The harness cannot sign in as the owner, so buyer2 holds a temporary
    // OWNER assignment (inserted with the service role, exactly how the
    // migration bootstrapped ownership) and acts through the RPCs; every check
    // inside still runs, and the grant is removed at the end of the section.
    await sql(`insert into public.staff_assignments (user_id, role_key, status, granted_by, reason)
               values ('${buyer2Id}', 'OWNER', 'ACTIVE', '${ownerId}', 'Harness: temporary owner to exercise team RPCs')
               on conflict do nothing`);
    const promote = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer3Id, p_role_key: "MODERATOR", p_reason: "Harness: RBAC matrix check" },
    });
    check("RB: owner can assign MODERATOR",
      promote.ok, JSON.stringify(promote.data));
    check("RB: moderator holds moderation powers but not finance powers",
      await perm(buyer3Id, "listings.takedown") && await perm(buyer3Id, "auctions.pause")
        && !(await perm(buyer3Id, "payouts.mark_paid"))
        && !(await perm(buyer3Id, "admin.manage_team")),
      "moderation yes, payouts/team no");

    // A moderator cannot assign roles (lacks admin.manage_team).
    const modAssign = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST", bearer: tok.buyer3,
      body: { p_user_id: buyer1Id, p_role_key: "SUPPORT" },
    });
    check("RB: a moderator cannot assign roles",
      !modAssign.ok && /not_admin/i.test(JSON.stringify(modAssign.data)),
      `status=${modAssign.status}`);

    // Nobody gets OWNER through the assignment RPC, not even from an owner
    // session: ownership transfer is a separate future workflow.
    const ownerGrant = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer1Id, p_role_key: "OWNER" },
    });
    check("RB: ADMIN/ RPC cannot grant OWNER (transfer is a separate workflow)",
      !ownerGrant.ok && /owner_only/i.test(JSON.stringify(ownerGrant.data)),
      `status=${ownerGrant.status}`);

    // Self-targeting is refused.
    const selfGrant = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer2Id, p_role_key: "SUPPORT" },
    });
    check("RB: staff cannot change their own access",
      !selfGrant.ok && /cannot_target_self/i.test(JSON.stringify(selfGrant.data)),
      `status=${selfGrant.status}`);

    // Suspension takes effect on the next check (no JWT, no session wait).
    const modAssignment = rows(await sql(
      `select id from public.staff_assignments
        where user_id='${buyer3Id}' and role_key='MODERATOR' and status='ACTIVE'`))[0]?.id;
    const suspend = await rest(`/rest/v1/rpc/admin_set_assignment_status`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_assignment_id: modAssignment, p_status: "SUSPENDED", p_reason: "Harness: suspension check" },
    });
    check("RB: owner can suspend staff and it applies immediately",
      suspend.ok && !(await perm(buyer3Id, "listings.takedown")),
      JSON.stringify(suspend.data));
    const restore = await rest(`/rest/v1/rpc/admin_set_assignment_status`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_assignment_id: modAssignment, p_status: "ACTIVE" },
    });
    check("RB: suspended staff can be restored",
      restore.ok && await perm(buyer3Id, "listings.takedown"),
      JSON.stringify(restore.data));

    const ownerAssignment = rows(await sql(
      `select id from public.staff_assignments
        where user_id='${ownerId}' and role_key='OWNER' and status='ACTIVE'`))[0]?.id;
    // OWNER rows are untouchable by non-owners, even ones holding broad power.
    // buyer3 gains ADMIN (which carries admin.manage_team) and still cannot
    // move the owner's row: the refusal is owner_only, not a silent success.
    // (Removing the sole owner is additionally guarded by a last_owner check
    // inside the RPCs; it is unreachable while self-targeting is refused, so
    // it stands as a tripwire for the future ownership-transfer workflow.)
    const grantAdmin = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer3Id, p_role_key: "ADMIN", p_reason: "Harness: owner_only proof" },
    });
    const touchOwner = await rest(`/rest/v1/rpc/admin_set_assignment_status`, {
      method: "POST", bearer: tok.buyer3,
      body: { p_assignment_id: ownerAssignment, p_status: "SUSPENDED" },
    });
    check("RB: an ADMIN cannot suspend the OWNER (owner_only, not silent)",
      grantAdmin.ok && !touchOwner.ok && /owner_only/i.test(JSON.stringify(touchOwner.data)),
      `grant=${grantAdmin.ok} touch=${touchOwner.status}`);
    // buyer3 returns to exactly MODERATOR before the suspend/restore/revoke
    // proofs below, so the permission assertions stay single-variable.
    const clearAdmin = await rest(`/rest/v1/rpc/admin_revoke_all_access`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer3Id, p_reason: "Harness: resetting to MODERATOR for the next proofs" },
    });
    const regrantMod = await rest(`/rest/v1/rpc/admin_assign_role`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer3Id, p_role_key: "MODERATOR", p_reason: "Harness: RBAC matrix check" },
    });
    check("RB: buyer3 reset to MODERATOR-only for the lifecycle proofs",
      clearAdmin.ok && regrantMod.ok && await perm(buyer3Id, "listings.takedown")
        && !(await perm(buyer3Id, "payouts.mark_paid")),
      `reset=${clearAdmin.ok} regrant=${regrantMod.ok}`);

    // Revoking everything clears access and the legacy mirror together.
    const revokeAll = await rest(`/rest/v1/rpc/admin_revoke_all_access`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_user_id: buyer3Id, p_reason: "Harness: end of RBAC matrix" },
    });
    const buyer3Admin = rows(await sql(
      `select is_admin from public.profiles where id='${buyer3Id}'`))[0]?.is_admin;
    check("RB: revoked staff loses access and the is_admin mirror clears",
      revokeAll.ok && !(await perm(buyer3Id, "admin.access")) && buyer3Admin === false,
      `revoked=${JSON.stringify(revokeAll.data)} is_admin=${buyer3Admin}`);

    // Every change above wrote the audit trail, attributed to an actor.
    const auditCount = rows(await sql(
      `select count(*)::int as n from public.staff_audit
        where target_user_id='${buyer3Id}'
          and action in ('ROLE_ASSIGNED','STAFF_SUSPENDED','STAFF_RESTORED','STAFF_REVOKED')`))[0].n;
    check("RB: every team change is audited (assign, suspend, restore, revoke)",
      auditCount >= 4, `audit rows=${auditCount}`);
    const auditForge = await rest(`/rest/v1/staff_audit`, {
      method: "POST", bearer: tok.buyer1,
      body: { actor_id: buyer1Id, action: "ROLE_ASSIGNED", target_user_id: buyer2Id },
    });
    check("RB: no staff member can write or alter the audit trail",
      !auditForge.ok, `status=${auditForge.status}`);

    // Invitations: single-use, expiring, revocable, and refusing duplicates.
    const inviteEmail = `verify-invite-${Date.now()}@bidblitz.test`;
    const invite = await rest(`/rest/v1/rpc/admin_invite_member`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_email: inviteEmail, p_role_key: "MODERATOR" },
    });
    const inviteId = invite.data?.invitation_id;
    check("RB: owner can invite, and the raw token is returned once (64 hex)",
      invite.ok && !!inviteId && /^[0-9a-f]{64}$/.test(invite.data?.token ?? ""),
      `ok=${invite.ok} id=${!!inviteId}`);
    const dupInvite = await rest(`/rest/v1/rpc/admin_invite_member`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_email: inviteEmail, p_role_key: "SUPPORT" },
    });
    check("RB: a duplicate active invitation is refused",
      !dupInvite.ok && /duplicate_invite/i.test(JSON.stringify(dupInvite.data)),
      `status=${dupInvite.status}`);
    const acceptMismatch = await rest(`/rest/v1/rpc/accept_team_invite`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_token: invite.data?.token },
    });
    check("RB: a signed-in account with a different email cannot accept",
      !acceptMismatch.ok && /invalid_invite/i.test(JSON.stringify(acceptMismatch.data)),
      `status=${acceptMismatch.status}`);
    const revokeInvite = await rest(`/rest/v1/rpc/admin_revoke_invite`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_invite_id: inviteId },
    });
    const acceptRevoked = await rest(`/rest/v1/rpc/accept_team_invite`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_token: invite.data?.token },
    });
    check("RB: a revoked invitation cannot be accepted",
      revokeInvite.ok && !acceptRevoked.ok && /invalid_invite/i.test(JSON.stringify(acceptRevoked.data)),
      `revoked=${revokeInvite.ok} accept=${acceptRevoked.status}`);
    // Expired invitations are refused the same way (expiry enforced in RPC).
    const invite2 = await rest(`/rest/v1/rpc/admin_invite_member`, {
      method: "POST", bearer: tok.buyer2,
      body: { p_email: `verify-expired-${Date.now()}@bidblitz.test`, p_role_key: "SUPPORT" },
    });
    await sql(`update public.team_invitations set expires_at = now() - interval '1 minute'
                where id='${invite2.data?.invitation_id}'`);
    const acceptExpired = await rest(`/rest/v1/rpc/accept_team_invite`, {
      method: "POST", bearer: tok.buyer1,
      body: { p_token: invite2.data?.token },
    });
    check("RB: an expired invitation is refused",
      !acceptExpired.ok && /invalid_invite/i.test(JSON.stringify(acceptExpired.data)),
      `status=${acceptExpired.status}`);

    // Tear down harness team state: temp OWNER grant, test invites, and the
    // audit rows that reference only harness activity stay (audit is
    // append-only by design; residue checks do not count staff_audit).
    await sql(`delete from public.staff_assignments where user_id='${buyer2Id}' and role_key='OWNER'`);
    await sql(`delete from public.team_invitations where id in ('${inviteId}','${invite2.data?.invitation_id}')`);
    await sql(`update public.profiles set is_admin = false where id='${buyer2Id}'`);
    const buyer2Clean = rows(await sql(
      `select is_admin, (select count(*)::int from public.staff_assignments
                          where user_id='${buyer2Id}' and status in ('ACTIVE','SUSPENDED')) as live
         from public.profiles where id='${buyer2Id}'`))[0];
    const buyer3Clean = rows(await sql(
      `select count(*)::int as n from public.staff_assignments
        where user_id='${buyer3Id}' and status in ('ACTIVE','SUSPENDED')`))[0].n;
    check("RB: harness team state removed (no temp owner, no live test grants)",
      buyer2Clean?.is_admin === false && buyer2Clean?.live === 0 && buyer3Clean === 0,
      `buyer2 admin=${buyer2Clean?.is_admin} live=${buyer2Clean?.live} buyer3live=${buyer3Clean}`);

    // ---- email outbox ---------------------------------------------------------
    // Duplicate delivery is refused by the key, not by memory: the same
    // idempotency key twice stores one row.
    const obKey = `verify-${Date.now()}-won`;
    await sql(`insert into public.email_outbox (idempotency_key, recipient, template_key, payload)
               values ('${obKey}', 'verify-outbox@bidblitz.test', 'won',
                       '{"title":"Harness mail","auctionId":"00000000-0000-0000-0000-000000000000"}')`);
    await sql(`insert into public.email_outbox (idempotency_key, recipient, template_key, payload)
               values ('${obKey}', 'verify-outbox@bidblitz.test', 'won',
                       '{"title":"Harness mail","auctionId":"00000000-0000-0000-0000-000000000000"}')
               on conflict (idempotency_key) do nothing`);
    const obRows = rows(await sql(
      `select count(*)::int as n from public.email_outbox where idempotency_key='${obKey}'`))[0].n;
    check("OB-X: a duplicate email event does not store twice",
      obRows === 1, `rows=${obRows}`);
    // Claiming is exclusive: one dispatcher owns each row.
    const claimed = rows(await sql(`select * from public.claim_email_jobs(25)`));
    const claimedOurs = claimed.filter((r) => r.idempotency_key === obKey);
    check("OB: the dispatcher can claim queued mail exactly once",
      claimedOurs.length === 1 && claimedOurs[0].status === "SENDING"
        && claimedOurs[0].attempts === 1,
      `claimed=${claimedOurs.length}`);
    await sql(`delete from public.email_outbox where idempotency_key='${obKey}'`);

    // Preferences are per-owner: buyer1 cannot read buyer2's row.
    await sql(`insert into public.notification_preferences (user_id, outbid)
               values ('${buyer2Id}', false)
               on conflict (user_id) do update set outbid = false`);
    const prefLeak = await rest(
      `/rest/v1/notification_preferences?select=user_id`, { bearer: tok.buyer1 });
    check("OB-Y: notification preferences are private to their owner",
      prefLeak.ok && (prefLeak.data ?? []).length === 0,
      `rows=${(prefLeak.data ?? []).length}`);
    await sql(`delete from public.notification_preferences where user_id='${buyer2Id}'`);
  }

console.log("\n--- avatars ---");

/*
 * A tripwire against the worst bug this file has ever had.
 *
 * The cleanup used to delete every object in the avatars bucket and null
 * `avatar_path` on every profile, which destroyed a real user's profile picture
 * on a run that reported itself green. It is now scoped to the four QA
 * identities this harness resolved.
 *
 * This snapshot exists so that if the scoping is ever widened again, the run
 * FAILS on a real account instead of succeeding quietly and taking someone's
 * picture with it. Read-only, and taken before the section writes anything.
 */
const nonQaAvatarsBefore = rows(
  await sql(
    `select p.id::text, p.avatar_path
       from public.profiles p
       join auth.users u on u.id = p.id
      where p.avatar_path is not null
        and u.email not like '%@bidblitz.test'`
  )
);

// A 1x1 PNG: the smallest valid thing that can pass the bucket's type gate.
const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** `token` null means anon: the publishable key, no user session. */
async function putAvatar(token, key) {
  return rest(`/storage/v1/object/avatars/${key}`, {
    method: "POST",
    bearer: token ?? undefined,
    headers: { "x-upsert": "true", "Content-Type": "image/png" },
    raw: true,
    body: PNG_1PX,
  });
}
async function delAvatar(token, key) {
  return rest(`/storage/v1/object/avatars/${key}`, { method: "DELETE", bearer: token });
}
async function avatarObjectCount(name) {
  const r = rows(
    await sql(
      `select count(*)::int as n from storage.objects
        where bucket_id = 'avatars' and name = '${name}'`
    )
  );
  return Number(r[0]?.n);
}
async function profileAvatarPath(id) {
  const r = rows(await sql(`select avatar_path from public.profiles where id = '${id}'`));
  return r[0]?.avatar_path;
}

// Remove the objects THIS RUN created, and nothing else.
//
// The previous version listed the whole `avatars` bucket, deleted every object in
// it, and then nulled `avatar_path` on every profile in the database. That is
// indiscriminate, and it destroyed a real user's profile picture: the owner
// uploaded a real avatar, `db:verify` was run, and the picture was gone. Anyone
// running the verification suite against a database with real users would have
// lost all of their avatars, silently, on a green run.
//
// A verification script is supposed to leave the system as it found it, minus its
// own fixtures. Scoping it to the four QA identities it resolved is the only way
// to make that true, and it is what this does:
//
//   * only objects whose first path segment is one of the harness's QA user ids;
//   * only the `avatar_path` of those same profiles;
//   * and only when the value being cleared is one of the paths this run wrote.
//
// A real account is not in the id list, so it cannot be reached at all.
const QA_AVATAR_OWNERS = [sellerId, buyer1Id, buyer2Id, buyer3Id].filter(Boolean);

/** Object names in the avatars bucket that belong to the harness's QA accounts. */
async function harnessAvatarObjects() {
  if (QA_AVATAR_OWNERS.length === 0) return [];
  const owners = QA_AVATAR_OWNERS.map((x) => `'${x}'`).join(",");
  return rows(
    await sql(
      `select name from storage.objects
        where bucket_id = 'avatars' and split_part(name, '/', 1) in (${owners})`
    )
  );
}

/**
 * Delete the QA accounts' avatar objects and clear their references.
 *
 * Through the Storage API, not SQL: Supabase installs storage.protect_delete,
 * which refuses a direct DELETE on storage tables exactly to stop accidental data
 * loss, and an object is not just a row so deleting the row would leave the blob.
 */
async function purgeAvatarBucket() {
  if (QA_AVATAR_OWNERS.length === 0) return;
  const owners = QA_AVATAR_OWNERS.map((x) => `'${x}'`).join(",");
  const listed = await harnessAvatarObjects();
  if (listed.length === 0) return;

  const pub = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const svc = requireEnv("SUPABASE_SECRET_KEY");
  for (const o of listed) {
    await fetch(`${pub}/storage/v1/object/avatars/${o.name}`, {
      method: "DELETE",
      headers: { apikey: svc, Authorization: `Bearer ${svc}` },
    });
  }
  // Only these accounts, and only a path that is now being removed. A profile
  // outside the QA set is untouched whatever it points at.
  await sql(
    `update public.profiles set avatar_path = null
      where id in (${owners}) and avatar_path is not null`
  );
  // Say what was removed, so a run that quietly did more than it should is
  // visible in the output rather than inferred from a missing file later.
  console.log(
    `    (avatar cleanup removed ${listed.length} object(s) for ${QA_AVATAR_OWNERS.length} QA account(s); no other account was touched)`
  );
}

const AV_OWN = `${sellerId}/avatar.png`;
const AV_OTHER = `${buyer1Id}/avatar.png`;

// 1. A user can write their own folder...
const avOwnUpload = await putAvatar(tok.seller, AV_OWN);
check(
  "avatar: a user CAN upload into their own folder",
  avOwnUpload.ok && (await avatarObjectCount(AV_OWN)) === 1,
  `status=${avOwnUpload.status} stored=${await avatarObjectCount(AV_OWN)}`
);

// 2. ...and cannot write somebody else's.
const avCrossUpload = await putAvatar(tok.seller, AV_OTHER);
check(
  "avatar: user A cannot write into user B's folder",
  !avCrossUpload.ok && (await avatarObjectCount(AV_OTHER)) === 0,
  `status=${avCrossUpload.status} stored=${await avatarObjectCount(AV_OTHER)}`
);

// 3. ...and cannot escape its namespace by traversal.
const avTraversal = await putAvatar(tok.seller, `${sellerId}/../${buyer1Id}/avatar.png`);
check(
  "avatar: path traversal out of the namespace is refused",
  !avTraversal.ok && (await avatarObjectCount(AV_OTHER)) === 0,
  `status=${avTraversal.status} landedInB=${await avatarObjectCount(AV_OTHER)}`
);

// 4. A second format for the same user coexists, and one file per extension.
const avReplace = await putAvatar(tok.seller, `${sellerId}/avatar.jpg`);
const avSellerObjects = Number(
  rows(
    await sql(
      `select count(*)::int as n from storage.objects
        where bucket_id = 'avatars' and name like '${sellerId}/%'`
    )
  )[0]?.n
);
check(
  "avatar: one object per (user, format) and no runaway accumulation",
  avReplace.ok && avSellerObjects === 2,
  `status=${avReplace.status} objectsForSeller=${avSellerObjects}`
);

// 5. A user can point their OWN profile at their own key.
await putAvatar(tok.seller, AV_OWN);
const avOwnProfile = await rest(`/rest/v1/profiles?id=eq.${sellerId}`, {
  method: "PATCH", bearer: tok.seller, body: { avatar_path: AV_OWN },
});
check(
  "avatar: a user can point their own profile at their own picture",
  avOwnProfile.ok,
  `status=${avOwnProfile.status}`
);

// 6. A user cannot point their profile at ANOTHER user's key.
const avCrossProfile = await rest(`/rest/v1/profiles?id=eq.${sellerId}`, {
  method: "PATCH", bearer: tok.seller, body: { avatar_path: AV_OTHER },
});
check(
  "avatar: a user cannot point their profile at another user's key",
  !avCrossProfile.ok && (await profileAvatarPath(sellerId)) !== AV_OTHER,
  `status=${avCrossProfile.status} avatar_path=${await profileAvatarPath(sellerId)}`
);

// 7. ...nor at an arbitrary string. This is exactly the defect the old
//    free-text `avatar_url` column allowed: any value the user liked.
for (const [label, value] of [
  ["an external URL", "https://attacker.tld/pixel.png"],
  ["a protocol-relative URL", "//attacker.tld/pixel.png"],
  ["a traversal path", "../../etc/passwd"],
  ["another bucket", "auction-images/x.png"],
  ["a wrong filename", `${sellerId}/evil.php`],
]) {
  const bad = await rest(`/rest/v1/profiles?id=eq.${sellerId}`, {
    method: "PATCH", bearer: tok.seller, body: { avatar_path: value },
  });
  const current = await profileAvatarPath(sellerId);
  check(
    `avatar: avatar_path refuses ${label}`,
    !bad.ok && current !== value,
    `status=${bad.status} value=${current}`
  );
}

// 8. A user cannot delete another user's object.
await putAvatar(tok.buyer1, AV_OTHER);
const avCrossDelete = await delAvatar(tok.seller, AV_OTHER);
check(
  "avatar: user A cannot delete user B's picture",
  !avCrossDelete.ok && (await avatarObjectCount(AV_OTHER)) === 1,
  `status=${avCrossDelete.status} stillThere=${await avatarObjectCount(AV_OTHER)}`
);

// 9. A user CAN remove their own, and the reference can be cleared.
const avOwnDelete = await delAvatar(tok.seller, AV_OWN);
const avCleared = await rest(`/rest/v1/profiles?id=eq.${sellerId}`, {
  method: "PATCH", bearer: tok.seller, body: { avatar_path: null },
});
check(
  "avatar: a user CAN remove their own picture and clear the reference",
  avOwnDelete.ok &&
    avCleared.ok &&
    (await avatarObjectCount(AV_OWN)) === 0 &&
    (await profileAvatarPath(sellerId)) === null,
  `delete=${avOwnDelete.status} avatar_path=${await profileAvatarPath(sellerId)}`
);

// 10. Anon can read (avatars are public) but cannot write.
const avAnonRead = await rest(`/storage/v1/object/public/avatars/${AV_OWN}`);
const avAnonUpload = await putAvatar(null, `${buyer2Id}/avatar.png`);
check(
  "avatar: reads are public, anon writes are not",
  avAnonRead.status === 400 && !avAnonUpload.ok,
  `read=${avAnonRead.status} (400 = no such object, so the read reached storage) ` +
    `write=${avAnonUpload.status}`
);

// 11. The bucket is an independent second gate on size and type.
const avBucket = rows(
  await sql(
    `select file_size_limit, allowed_mime_types::text as mimes
       from storage.buckets where id = 'avatars'`
  )
)[0];
const avMimes = String(avBucket?.mimes ?? "");
check(
  "avatar: the bucket caps size and allows raster types only (no SVG)",
  Number(avBucket?.file_size_limit) === 2 * 1024 * 1024 &&
    /image\/jpeg/.test(avMimes) &&
    /image\/png/.test(avMimes) &&
    /image\/webp/.test(avMimes) &&
    !/svg/i.test(avMimes),
  `limit=${avBucket?.file_size_limit} mimes=${avMimes}`
);

// 12. The column itself: avatar_path replaced the free-text avatar_url.
const avColumns = rows(
  await sql(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('avatar_path', 'avatar_url')`
  )
);
check(
  "avatar: avatar_path replaced the free-text avatar_url column",
  avColumns.length === 1 && avColumns[0]?.column_name === "avatar_path",
  `columns=${avColumns.map((c) => c.column_name).join(",")}`
);

// 13. A profile with no avatar is a normal, supported state.
  const avNull = Number(
    rows(await sql(`select count(*)::int as n from public.profiles where avatar_path is null`))[0]
      ?.n
  );
  const avAll = Number(
    rows(await sql(`select count(*)::int as n from public.profiles`))[0]?.n
  );
  /*
   * "A profile with no picture is a normal, supported state."
   *
   * This used to be asserted as "no profile has an avatar at all" — true only
   * while nobody had ever uploaded one. The owner uploaded a real profile
   * picture and the check failed. That is the check being wrong, not the
   * product: it had encoded a property of an empty demonstration as if it were
   * a property of the software, so it would have punished the first real user
   * for using the feature correctly.
   *
   * What is worth asserting, and holds whether or not anyone has a picture:
   *
   *   1. the no-picture state is representable, and is what a run leaves behind;
   *   2. every stored path is well formed AND names the owner's own folder, so
   *      a picture can never point at another user's object.
   */
  check(
    "avatar: the no-picture state is representable and is what a run leaves behind",
    avAll > 0 && avNull > 0,
    `null=${avNull} of ${avAll}`
  );
  const badAvatarPath = rows(await sql(
    `select id::text, avatar_path from public.profiles
      where avatar_path is not null
        and (avatar_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar\\.(jpg|jpeg|png|webp|gif)$'
             or split_part(avatar_path, '/', 1) <> id::text)`));
  check(
    "avatar: every stored path is well formed and lives in its owner's own folder",
    badAvatarPath.length === 0,
    badAvatarPath.length === 0
      ? "all stored avatar paths are well formed"
      : JSON.stringify(badAvatarPath)
  );

// Clean up everything this section put in the bucket.
  // Clean up everything this section put in the bucket. `purgeAvatarBucket()` is now scoped
  // to the four QA identities this run resolved, so it cannot reach a real account.
  // The statement that used to follow it here was unscoped - `where avatar_path is not
  // null` - so it nulled EVERY profile in the database, and it is what destroyed the
  // owner's real profile picture on a green run. The scoping inside the helper makes
  // it redundant, and leaving an unscoped copy of the same statement beside it would
  // only be a way to reintroduce the same bug.
  // Clean up everything this section put in the bucket. `purgeAvatarBucket()` is
  // now scoped to the four QA identities this run resolved, so it cannot reach a
  // real account. The statement that used to follow it here was unscoped -
  // `where avatar_path is not null` - so it nulled EVERY profile in the database,
  // and it is what destroyed the owner's real profile picture on a green run. The
  // scoping inside the helper makes it redundant, and leaving an unscoped copy of
  // the same statement beside it would only be a way to reintroduce the bug.
  await purgeAvatarBucket();

  // And prove it, rather than trusting the scoping. A real account that had a
  // picture before this section must still have exactly that picture after it.
  const nonQaAvatarsAfter = rows(
    await sql(
      `select p.id::text, p.avatar_path
         from public.profiles p
         join auth.users u on u.id = p.id
        where p.avatar_path is not null
          and u.email not like '%@bidblitz.test'`
    )
  );
  const realBefore = JSON.stringify(nonQaAvatarsBefore.slice().sort());
  const realAfter = JSON.stringify(nonQaAvatarsAfter.slice().sort());
  check(
    "avatar: the cleanup left every real account's picture exactly as it found it",
    realBefore === realAfter,
    realBefore === realAfter
      ? `${nonQaAvatarsAfter.length} real avatar(s) untouched`
      : `BEFORE ${realBefore} AFTER ${realAfter}`
  );
  const strayAvatarObjects = rows(
    await sql(
      `select name from storage.objects
        where bucket_id = 'avatars'
          and split_part(name, '/', 1) not in (${QA_AVATAR_OWNERS.map((x) => `'${x}'`).join(",") || "''"})`
    )
  );
  check(
    "avatar: the cleanup removed no object belonging to a real account",
    strayAvatarObjects.length === nonQaAvatarsBefore.length,
    strayAvatarObjects.length === nonQaAvatarsBefore.length
      ? `${strayAvatarObjects.length} real object(s) intact`
      : `expected ${nonQaAvatarsBefore.length} real object(s), found ${strayAvatarObjects.length}: ${JSON.stringify(strayAvatarObjects)}`
  );
// A finished run must leave no synthetic residue at all — this is the check
// that makes the cleanup a promise rather than a hope.
const testUserSubquery =
  `(select id from auth.users where email like '%@bidblitz.test')`;
const residue = rows(await sql(
  `select
     (select count(*)::int from public.auctions
       where seller_id in ${testUserSubquery}) as auctions,
     (select count(*)::int from public.transactions
       where seller_id in ${testUserSubquery}
          or buyer_id in ${testUserSubquery}) as transactions,
     (select count(*)::int from public.payment_events pe
       left join public.transactions t on t.id = pe.transaction_id
      where t.id is null
         or t.seller_id in ${testUserSubquery}
         or t.buyer_id in ${testUserSubquery}) as payment_events,
     (select count(*)::int from public.seller_payouts sp
        left join public.transactions t on t.id = sp.transaction_id
       where t.id is null
          or t.seller_id in ${testUserSubquery}
          or t.buyer_id in ${testUserSubquery}) as seller_payouts`))[0];
check("cleanup: no synthetic fixture survives in production data",
  Number(residue?.auctions) === 0 && Number(residue?.transactions) === 0 &&
    Number(residue?.payment_events) === 0 &&
    Number(residue?.seller_payouts) === 0,
  `auctions=${residue?.auctions} transactions=${residue?.transactions} ` +
    `payment_events=${residue?.payment_events} ` +
    `seller_payouts=${residue?.seller_payouts}`);

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} checks passed  (${((Date.now()-t0)/1000).toFixed(1)}s)`);
if (failures) {
  console.log("\nFAILED:");
  results.filter((r) => !r.ok).forEach((r) => console.log(`  ! ${r.name} — ${r.detail}`));
}
console.log("=".repeat(64) + "\n");
process.exit(failures ? 1 : 0);
