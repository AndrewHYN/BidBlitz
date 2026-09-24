import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
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
