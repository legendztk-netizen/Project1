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
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["test/smoke/**/*.test.ts", "node_modules/**"],
  },
});
