/**
 * Post-migration RLS proof for transaction messaging.
 *
 * Run AFTER `npm run db:migrate` has applied
 * 20261001000001_transaction_messaging.sql:
 *
 *   node scripts/db/verify-messaging-rls.mjs
 *
 * Optional party-level proof (needs two QA accounts that share one settled
 * transaction — the winner and the seller of any SOLD auction):
 *
 *   QA_BUYER_EMAIL=... QA_BUYER_PASSWORD=... \
 *   QA_STRANGER_EMAIL=... QA_STRANGER_PASSWORD=... \
 *   QA_TRANSACTION_ID=... node scripts/db/verify-messaging-rls.mjs
 *
 * Never prints message bodies, tokens, or credentials. Exits non-zero on the
 * first failed expectation so CI can gate on it.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadLocalEnv() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] in process.env) continue;
    process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
}
loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !pub) {
  console.error("[messaging-rls] missing Supabase public configuration");
  process.exit(2);
}

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "ok" : "FAIL"} - ${name}`);
  if (!cond) failures += 1;
}

const anon = createClient(url, pub, { auth: { persistSession: false } });

// 1. The table exists and is invisible to anonymous callers.
const anonSelect = await anon.from("transaction_messages").select("id").limit(1);
check("table exists (no relation error)", !/relation .* does not exist/i.test(anonSelect.error?.message ?? ""));
check("anon select returns zero rows", (anonSelect.data ?? []).length === 0);

const anonInsert = await anon
  .from("transaction_messages")
  .insert({ transaction_id: "123e4567-e89b-42d3-a456-426614174000", sender_id: "123e4567-e89b-42d3-a456-426614174000", body: "probe" });
check("anon insert refused", !!anonInsert.error);

// 2. Party-level proof when QA credentials are supplied.
const { QA_BUYER_EMAIL, QA_BUYER_PASSWORD, QA_STRANGER_EMAIL, QA_STRANGER_PASSWORD, QA_TRANSACTION_ID } = process.env;
if (QA_BUYER_EMAIL && QA_BUYER_PASSWORD && QA_STRANGER_EMAIL && QA_STRANGER_PASSWORD && QA_TRANSACTION_ID) {
  const buyerClient = createClient(url, pub, { auth: { persistSession: false } });
  const strangerClient = createClient(url, pub, { auth: { persistSession: false } });
  const b = await buyerClient.auth.signInWithPassword({ email: QA_BUYER_EMAIL, password: QA_BUYER_PASSWORD });
  const s = await strangerClient.auth.signInWithPassword({ email: QA_STRANGER_EMAIL, password: QA_STRANGER_PASSWORD });
  check("buyer signs in", !b.error);
  check("stranger signs in", !s.error);
  if (!b.error && !s.error) {
    const partySelect = await buyerClient.from("transaction_messages").select("id").eq("transaction_id", QA_TRANSACTION_ID).limit(5);
    check("party select succeeds", !partySelect.error);
    const strangerSelect = await strangerClient.from("transaction_messages").select("id").eq("transaction_id", QA_TRANSACTION_ID).limit(5);
    check("non-party select returns zero rows", !strangerSelect.error && (strangerSelect.data ?? []).length === 0);
    const strangerInsert = await strangerClient.from("transaction_messages").insert({ transaction_id: QA_TRANSACTION_ID, sender_id: s.data.user.id, body: "intrusion probe" });
    check("non-party insert refused", !!strangerInsert.error);
    const partyInsert = await buyerClient
      .from("transaction_messages")
      .insert({ transaction_id: QA_TRANSACTION_ID, sender_id: b.data.user.id, body: `RLS probe ${Date.now()}` })
      .select("id")
      .single();
    check("party insert succeeds", !partyInsert.error);
    const probeId = !partyInsert.error ? partyInsert.data?.id : null;
    if (probeId) {
      // History is evidence: parties have no delete policy by design, so the
      // exact probe row (by returned id, never "latest") is removed with the
      // service key when available, and reported loudly when it is not.
      if (process.env.SUPABASE_SECRET_KEY) {
        const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
        const cleaned = await admin.from("transaction_messages").delete().eq("id", probeId);
        console.log(cleaned.error ? "WARN - probe row left in thread (delete failed)" : "ok - probe row cleaned up");
      } else {
        console.log("WARN - probe row left in thread (no SUPABASE_SECRET_KEY to clean it)");
      }
    }
  }
} else {
  console.log("skip - party-level proof needs QA_BUYER_EMAIL/QA_BUYER_PASSWORD/QA_STRANGER_EMAIL/QA_STRANGER_PASSWORD/QA_TRANSACTION_ID");
}

if (failures > 0) {
  console.error(`[messaging-rls] ${failures} expectation(s) failed`);
  process.exit(1);
}
console.log("[messaging-rls] all expectations held");
