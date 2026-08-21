import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./migrations",
  schema: [
    "./app/modules/admin/infrastructure/database-schema.ts",
    "./app/modules/catalog/infrastructure/database-schema.ts",
  ],
  strict: true,
});
