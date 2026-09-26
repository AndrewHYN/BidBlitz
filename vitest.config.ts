import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next aliases this marker itself; vitest cannot, and the package is
      // not installed standalone. See test/server-only-stub.ts.
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "**/node_modules/**"],
    // src/server/rate-limit.ts starts a (unref'd) interval at module load;
    // running all files in one fork keeps `vitest run` exiting cleanly.
    pool: "forks",
    fileParallelism: false,
    teardownTimeout: 10_000,
  },
});
