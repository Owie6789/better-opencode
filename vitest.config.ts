import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types.ts"],
      thresholds: {
        // lines 80 retained for regression detection; functions 70 / branches 65 are intentionally
        // lower because optional native deps (better-sqlite3/sqlite-vec, onnxruntime-node, web-tree-sitter)
        // and platform-specific fsync/lock branches (instinctsStore.ts, lock.ts on Windows) are not
        // exercised in CI. See vectorStore.ts, embedder.ts, chunker.ts for fallback paths.
        lines: 80,
        functions: 70,
        branches: 65,
      },
    },
    testTimeout: 15000,
  },
});
