/**
 * Vitest stand-in for the `server-only` marker package.
 *
 * Next.js aliases `server-only` itself at build time (it resolves to
 * `next/dist/compiled/server-only`, which throws if the module reaches a
 * client bundle). Vitest has no such alias, and the package is not installed
 * standalone, so without this the server modules under test could not be
 * imported at all.
 *
 * The marker's whole job is to FAIL when misused; the test runner's job is to
 * exercise those modules deliberately, so the marker is neutralised here and
 * only here. Nothing else about the modules changes: they still run in the
 * node environment, with the node built-ins they need.
 */
export {};
