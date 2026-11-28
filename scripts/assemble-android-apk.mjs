import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const directory = join(process.cwd(), "android", "distribution", "1.0.0");
const parts = await Promise.all(Array.from({ length: 15 }, (_, i) =>
  readFile(join(directory, String(i).padStart(2, "0") + ".part"))));
const apk = Buffer.concat(parts);
const expected = "e79900f6702ed653ac9c9799c0bdef9e2b301a24016491a7a34ed91504b6a3d7";
if (apk.length !== 3680855 || createHash("sha256").update(apk).digest("hex") !== expected) {
  throw new Error("Android installer integrity verification failed");
}
const output = join(process.cwd(), "public", "downloads");
await mkdir(output, { recursive: true });
await writeFile(join(output, "BidBlitz-1.0.0.apk"), apk);
console.log("Verified and staged BidBlitz Android 1.0.0 APK");
