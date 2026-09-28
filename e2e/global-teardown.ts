import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Playwright global teardown: remove the fixtures the suite just created.
 *
 * The end-to-end suite publishes real auctions, uploads real files and places
 * real bids through the real app — that is the only way it can test anything
 * real. Against the production Supabase project that means it writes production
 * rows, and until this hook existed nothing took them away. On 2026-09-28 that
 * left ten test listings visible on the homepage of a commercial product.
 *
 * This runs the same conservative script an operator can run by hand
 * (`npm run db:cleanup-e2e`). It is deliberately best-effort: if the Supabase
 * access token is not in the environment the suite still passes, but it says
 * loudly that fixtures were left behind rather than pretending the run was
 * clean. A silent skip here is exactly the failure mode that caused this.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "scripts", "db", "cleanup-e2e-fixtures.mjs");

export default function globalTeardown(): void {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.warn(
      "\n[e2e teardown] SUPABASE_ACCESS_TOKEN is not set, so the e2e fixtures this\n" +
        "              run created were NOT cleaned up and are still in the database.\n" +
        "              Set the token and run: npm run db:cleanup-e2e -- --yes\n"
    );
    return;
  }

  const result = spawnSync(process.execPath, [script, "--yes"], {
    stdio: "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    console.warn(
      "\n[e2e teardown] fixture cleanup FAILED (exit " +
        String(result.status) +
        "). Fixtures from this run may still be in the database.\n" +
        "              Re-run: npm run db:cleanup-e2e -- --yes\n"
    );
  }
}
