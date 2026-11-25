/**
 * Listing media migration. Dry-run by default; no objects are ever deleted.
 * Use a trusted operator machine, never a public CI artifact or web endpoint.
 */
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile, realpath } from "node:fs/promises";
import path from "node:path";

const PROJECT = "zteakuiuvcikwpnkgxsn";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || new URL(url).hostname !== PROJECT + ".supabase.co" || !key) {
  throw new Error("Set the verified BidBlitz URL and server-only service credential locally.");
}
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rollback = args.includes("--rollback");
if (apply && rollback) throw new Error("Choose apply OR rollback.");
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 1;
if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Limit must be 1–100.");
const backupArg = args.find(a => a.startsWith("--backup="))?.slice(9);
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = client.storage.from("auction-images");
const digest = data => createHash("sha256").update(data).digest("hex");
const check = result => { if (result.error) throw new Error(result.error.message); return result.data; };
let dir, journal;
if (apply || rollback) {
  if (!backupArg || !path.isAbsolute(backupArg)) throw new Error("Use an absolute --backup path outside the repository.");
  await mkdir(backupArg, { recursive: true, mode: 0o700 });
  dir = await realpath(backupArg);
  const cwd = await realpath(process.cwd());
  if (dir === cwd || dir.startsWith(cwd + path.sep)) throw new Error("Backup must not be inside the repository.");
  journal = path.join(dir, "listing-media-journal.jsonl");
}
async function downloaded(storagePath) {
  const blob = check(await bucket.download(storagePath));
  return Buffer.from(await blob.arrayBuffer());
}
async function writeBackup(file, data) {
  try { await writeFile(file, data, { flag: "wx", mode: 0o600 }); }
  catch (e) {
    if (e.code !== "EEXIST" || digest(await readFile(file)) !== digest(data)) throw e;
  }
}
async function encode(bytes) {
  const meta = await sharp(bytes, { animated: true, limitInputPixels: 60_000_000 }).metadata();
  if ((meta.pages ?? 1) > 1) return null; // preserve animation, don't flatten.
  let best = null;
  for (const size of [1600, 1280, 1024, 960]) {
    for (const quality of [84, 76, 68, 60]) {
      const candidate = await sharp(bytes, { limitInputPixels: 60_000_000 })
        .rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .webp({ quality }).toBuffer({ resolveWithObject: true });
      if (!best || candidate.data.length < best.data.length) best = candidate;
      if (candidate.data.length <= 200_000) return candidate;
    }
  }
  return best && best.data.length <= 350_000 ? best : null;
}
if (rollback) {
  const entries = (await readFile(journal, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
  let restored = 0;
  for (const entry of entries.reverse()) {
    // Never resurrect a removed listing or overwrite a seller's subsequent edit.
    const original = await downloaded(entry.before.storage_path);
    if (digest(original) !== entry.originalHash) throw new Error("Original is missing or changed; stop and restore from backup first.");
    const rows = check(await client.from("auction_images").update({
      storage_path: entry.before.storage_path, width: entry.before.width,
      height: entry.before.height, bytes: entry.before.bytes,
    }).eq("id", entry.before.id).eq("storage_path", entry.newPath).select("id"));
    restored += rows.length;
  }
  console.log(JSON.stringify({ restored, deletedObjects: 0 }));
} else {
  const rows = check(await client.from("auction_images")
    .select("id,auction_id,storage_path,width,height,bytes").order("id").limit(1000));
  const candidates = rows.filter(r => !/\.bb-opt-[a-f0-9]{24}\.webp$/.test(r.storage_path));
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", candidates: candidates.length, batchLimit: limit, downloads: 0 }));
  } else {
    let migrated = 0, skipped = 0, before = 0, after = 0, attempted = 0;
    for (const row of candidates) {
      if (attempted >= limit) break;
      if (!row.storage_path.startsWith(row.auction_id + "/")) throw new Error("Unexpected listing namespace");
      // Skip known already-small files without downloading. Null bytes must be inspected.
      if (row.bytes !== null && row.bytes <= 200_000) { skipped++; continue; }
      attempted++;
      const original = await downloaded(row.storage_path);
      if (original.length <= 200_000) { skipped++; continue; }
      const optimized = await encode(original);
      if (!optimized || optimized.data.length >= original.length) { skipped++; continue; }
      const originalHash = digest(original);
      const newPath = row.auction_id + "/" + row.id + ".bb-opt-" + digest(optimized.data).slice(0,24) + ".webp";
      await writeBackup(path.join(dir, row.id + "-" + originalHash + ".original"), original);
      await writeBackup(path.join(dir, row.id + "-" + originalHash + ".json"), Buffer.from(JSON.stringify(row)));
      const upload = await bucket.upload(newPath, optimized.data, { upsert: false, contentType: "image/webp", cacheControl: "3600" });
      // An interrupted run can have already uploaded this exact deterministic object.
      // A different or missing object aborts, regardless of the upload status.
      const remote = await downloaded(newPath);
      if (digest(remote) !== digest(optimized.data)) throw new Error("Replacement verification failed");
      if (upload.error) console.log("Reusing verified existing replacement.");
      const verification = await sharp(remote).metadata();
      if (!verification.width || !verification.height || verification.format !== "webp") throw new Error("Invalid replacement");
      // Durable journal precedes the database change, including on interruption.
      await appendFile(journal, JSON.stringify({before:row,newPath,originalHash}) + "\n", {mode:0o600,flush:true});
      const changed = check(await client.from("auction_images").update({
        storage_path:newPath,width:verification.width,height:verification.height,bytes:remote.length,
      }).eq("id",row.id).eq("storage_path",row.storage_path).select("id"));
      if (changed.length !== 1) throw new Error("Concurrent listing change; original and replacement retained.");
      before += original.length; after += remote.length; migrated++;
    }
    console.log(JSON.stringify({ migrated, skipped, attempted, beforeBytes:before, afterBytes:after, deletedObjects:0 }));
  }
}
