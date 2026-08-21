import { describe, expect, it, vi } from "vitest";

import {
  deploymentStageNames,
  runDeploymentPipeline,
} from "../scripts/deployment-pipeline.mjs";

describe("controlled deployment pipeline", () => {
  it("runs validation, migrations, deploy, and health in strict order", async () => {
    const calls: string[] = [];

    await runDeploymentPipeline({
      environment: "production",
      mode: "validation",
      runStage: vi.fn(async (stage) => {
        calls.push(stage.name);
      }),
    });

    expect(calls).toEqual(deploymentStageNames);
  });

  it("stops before deploy and health when migration validation fails", async () => {
    const calls: string[] = [];

    await expect(
      runDeploymentPipeline({
        environment: "production",
        mode: "validation",
        runStage: async (stage) => {
          calls.push(stage.name);
          if (stage.name === "migrations") throw new Error("migration failed");
        },
      }),
    ).rejects.toThrow("migration failed");

    expect(calls).toEqual(["configuration", "migrations"]);
  });

  it("refuses a live production run without an explicit confirmation gate", async () => {
    await expect(
      runDeploymentPipeline({
        environment: "production",
        mode: "live",
        liveDeploymentConfirmation: undefined,
        runStage: vi.fn(),
      }),
    ).rejects.toThrow("ALLOW_CLOUDFLARE_DEPLOYMENT=confirmed");
  });
});
