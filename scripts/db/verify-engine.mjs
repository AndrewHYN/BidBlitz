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
  await sql(`delete from public.transactions where seller_id in (${list}) or buyer_id in (${list})`);
  await sql(`delete from public.bids where bidder_id in (${list})`);
  await sql(`delete from public.auctions where seller_id in (${list})`);
  await sql(`delete from public.notifications where user_id in (${list})`);
  await sql(`delete from public.watchlist where user_id in (${list})`);
  await sql(`delete from public.reports where reporter_id in (${list})`);
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
check("seller: publish_auction transitions DRAFT -> LIVE", pub.ok && pub.data?.status === "LIVE",
  JSON.stringify(pub.data));

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
await sql(`update public.auctions set ends_at = now() - interval '1 second'
            where id='${auctionId}'`);

const late = await rest(`/rest/v1/rpc/place_bid`, {
  method: "POST", bearer: tok.buyer1,
  body: { p_auction_id: auctionId, p_amount_minor: 999999, p_request_id: randomUUID() },
});
check("rule: bid after server-authoritative close rejected",
  !late.ok && /auction_ended/.test(JSON.stringify(late.data)),
  JSON.stringify(late.data));

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
