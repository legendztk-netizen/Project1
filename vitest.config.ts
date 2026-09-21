import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#workers": fileURLToPath(new URL("./workers", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Integration files start real local workerd/D1 instances.
    maxWorkers: 2,
    testTimeout: 15000,
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["test/smoke/**/*.test.ts", "node_modules/**"],
  },
});
