import { describe, expect, it } from "vitest";

import { createHealthResponse } from "../workers/health";

describe("health response", () => {
  it("returns the typed Worker identity without exposing configuration", async () => {
    const response = createHealthResponse({
      APP_ENV: "local",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      application: "hydraulic-hose-rfq-platform",
      environment: "local",
      status: "ok",
    });
  });
});
