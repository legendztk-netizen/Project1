import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 1,
    include: ["test/smoke/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
