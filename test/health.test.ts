import { describe, expect, it } from "vitest";

import { createHealthResponse } from "../workers/health";

function databaseFixture(options?: { fail?: boolean; migrations?: string[]; version?: number }) {
  const migrations = options?.migrations ?? ["0000_initial_catalog_release.sql"];
  const version = options?.version ?? 1;

  return {
    prepare(sql: string) {
      if (options?.fail) throw new Error("database unavailable");
      if (sql.includes("application_schema_state")) {
        return { first: async () => ({ version }) };
      }
      return {
        all: async () => ({ results: migrations.map((name) => ({ name })) }),
      };
    },
  } as unknown as D1Database;
}

describe("health response", () => {
  it("returns ready only after the expected D1 schema is applied", async () => {
    const response = await createHealthResponse({
      APP_ENV: "local",
      DB: databaseFixture(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      application: "hydraulic-hose-rfq-platform",
      database: {
        currentSchemaVersion: 1,
        missingMigrations: [],
        ready: true,
      },
      environment: "local",
      status: "ok",
    });
  });

  it("fails closed without exposing a database exception", async () => {
    const response = await createHealthResponse({
      APP_ENV: "local",
      DB: databaseFixture({ fail: true }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      database: {
        missingMigrations: ["0000_initial_catalog_release.sql"],
        ready: false,
        reason: "D1 schema metadata is unavailable",
      },
      status: "blocked",
    });
  });
});
