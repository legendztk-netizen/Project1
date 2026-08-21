import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/smoke/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
