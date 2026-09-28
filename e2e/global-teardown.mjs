// Playwright global teardown: remove the fixtures the suite just created.
//
// Plain .mjs on purpose. This file was first written as `.ts` with ES module
// syntax and it silently never ran: this package.json has no "type": "module",
// so Node loads a `.ts` file as CommonJS, Playwright's `import()` of it failed
// with "Failed to load the ES module", and the next Playwright run quietly put
// ten test listings back onto the production homepage. `.mjs` is always an ES
// module to Node, so this cannot happen again.
//
// The e2e suite publishes real auctions, uploads real files and places real
// bids through the real app - that is the only way it can test anything real.
// Against the production Supabase project that means it writes production rows,
// so they have to be removed when the run ends.
//
// Best-effort by design, but never silent: if the Supabase access token is not
// in the environment, or the cleanup exits non-zero, this says so loudly. A
// quiet skip is exactly the failure mode that caused the problem.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "scripts", "db", "cleanup-e2e-fixtures.mjs");

export default function globalTeardown() {
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
      "\n[e2e teardown] FIXTURE CLEANUP FAILED (exit " +
        String(result.status) +
        "). Fixtures from this run may still be in the database.\n" +
        "              Re-run: npm run db:cleanup-e2e -- --yes\n"
    );
  }
}
