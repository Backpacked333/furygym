import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share one database; run files one at a time so counts stay predictable.
    fileParallelism: false,
  },
});
