import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface EnvironmentDefinition {
  requiredSecrets: string[];
  resourceNames: {
    database: string;
    privateFiles: string;
    asyncJobs: string;
  };
  vars: Record<string, string>;
  workerName: string;
}

interface EnvironmentContract {
  environments: Record<
    "local" | "preview" | "production",
    EnvironmentDefinition
  >;
}

const root = new URL("../", import.meta.url);

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(new URL(relativePath, root), "utf8"));
}

describe("environment configuration contract", () => {
  it("uses distinct Worker, D1, R2, Queue, and origin names", () => {
    const contract = readJson(
      "config/environment-contract.json",
    ) as EnvironmentContract;
    const environments = Object.values(contract.environments);

    for (const select of [
      (item: EnvironmentDefinition) => item.workerName,
      (item: EnvironmentDefinition) => item.resourceNames.database,
      (item: EnvironmentDefinition) => item.resourceNames.privateFiles,
      (item: EnvironmentDefinition) => item.resourceNames.asyncJobs,
      (item: EnvironmentDefinition) => item.vars.PUBLIC_STOREFRONT_ORIGIN,
      (item: EnvironmentDefinition) => item.vars.ADMIN_ORIGIN,
    ]) {
      expect(new Set(environments.map(select)).size).toBe(3);
    }
  });

  it("does not select production identifiers in local or preview", () => {
    const contract = readJson(
      "config/environment-contract.json",
    ) as EnvironmentContract;
    const production = contract.environments.production;
    const nonProduction = JSON.stringify([
      contract.environments.local,
      contract.environments.preview,
    ]);

    for (const identifier of [
      production.workerName,
      ...Object.values(production.resourceNames),
      production.vars.PUBLIC_STOREFRONT_ORIGIN,
      production.vars.ADMIN_ORIGIN,
      ...production.requiredSecrets,
    ]) {
      expect(nonProduction).not.toContain(identifier);
    }
  });

  it("keeps every local persistence binding on the local workerd simulator", () => {
    const wrangler = readJson("wrangler.jsonc") as {
      d1_databases: Array<{ remote?: boolean }>;
      queues: { producers: Array<{ remote?: boolean }> };
      r2_buckets: Array<{ remote?: boolean }>;
    };

    expect(
      wrangler.d1_databases.every((binding) => binding.remote !== true),
    ).toBe(true);
    expect(
      wrangler.r2_buckets.every((binding) => binding.remote !== true),
    ).toBe(true);
    expect(
      wrangler.queues.producers.every((binding) => binding.remote !== true),
    ).toBe(true);
  });

  it.each(["local", "preview", "production"])(
    "keeps Wrangler %s aligned with the shared contract",
    (environment) => {
      const output = execFileSync(
        process.execPath,
        ["scripts/environment-config.mjs", "validate", environment],
        { cwd: new URL("../", import.meta.url), encoding: "utf8" },
      );

      expect(output).toContain(`environment=${environment}`);
      expect(output).toContain("contract=valid");
    },
  );

  it("keeps default commands local and environment commands explicit", () => {
    const packageJson = readJson("package.json") as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.dev).not.toContain("production");
    expect(packageJson.scripts.build).not.toContain("production");
    expect(packageJson.scripts.dev).toContain("env -u CLOUDFLARE_ENV");
    expect(packageJson.scripts["build:local"]).toContain(
      "env -u CLOUDFLARE_ENV",
    );
    expect(packageJson.scripts["dry-run:local"]).toContain(
      "env -u CLOUDFLARE_ENV",
    );
    expect(packageJson.scripts["dry-run:local"]).toContain("pnpm build:local");
    expect(packageJson.scripts["build:preview"]).toContain(
      "CLOUDFLARE_ENV=preview",
    );
    expect(packageJson.scripts["build:production"]).toContain(
      "CLOUDFLARE_ENV=production",
    );
    expect(packageJson.scripts["deploy:production"]).toBe(
      "node scripts/deployment-pipeline.mjs live production",
    );
    expect(packageJson.scripts.migrate).toBe(
      "node scripts/d1-migrations.mjs apply local",
    );
    expect(packageJson.scripts["migrate:preview"]).toContain("apply preview");
    expect(packageJson.scripts["migrate:production"]).toContain(
      "apply production",
    );
    expect(packageJson.scripts["deploy:validate:preview"]).toBe(
      "node scripts/deployment-pipeline.mjs validation preview",
    );
    expect(packageJson.scripts["deploy:validate:production"]).toBe(
      "node scripts/deployment-pipeline.mjs validation production",
    );
  });

  it("ignores an inherited production selector in the default build", () => {
    const packageJson = readJson("package.json") as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toBe("pnpm build:local");
    expect(packageJson.scripts["build:local"]).toMatch(
      /validate local.*env -u CLOUDFLARE_ENV.*react-router build/,
    );
  });

  it.each(["preview", "production"])(
    "blocks %s deployment while placeholders or secrets are missing",
    (environment) => {
      const result = spawnSync(
        process.execPath,
        ["scripts/environment-config.mjs", "require-deployable", environment],
        {
          cwd: new URL("../", import.meta.url),
          encoding: "utf8",
          env: {} as unknown as NodeJS.ProcessEnv,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Deployment blocked for ${environment}`);
      expect(result.stderr).toContain("D1 database_id");
      expect(result.stderr).toContain(
        `Missing deployment secret ${environment.toUpperCase()}_RESEND_API_KEY`,
      );
    },
  );

  it("keeps GitHub checks secret-free and validation-only", () => {
    const quality = readFileSync(
      new URL("../.github/workflows/quality.yml", import.meta.url),
      "utf8",
    );
    const deployment = readFileSync(
      new URL(
        "../.github/workflows/deployment-validation.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(quality).toContain("pnpm ci:check");
    expect(deployment).toContain("pnpm deploy:validate:production");
    expect(`${quality}\n${deployment}`).not.toContain("secrets.");
    expect(deployment).not.toContain("pnpm deploy:production");
  });

  it("blocks the live deployment entry point before evaluating remote resources", () => {
    const result = spawnSync("pnpm", ["deploy:production"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, ALLOW_CLOUDFLARE_DEPLOYMENT: "" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ALLOW_CLOUDFLARE_DEPLOYMENT=confirmed");
    expect(result.stdout).not.toContain("stage=configuration");
  });

  it("resolves preview and local commands after a production build without leaking production", () => {
    const contract = readJson(
      "config/environment-contract.json",
    ) as EnvironmentContract;
    const production = contract.environments.production;
    const productionIdentifiers = [
      production.workerName,
      ...Object.values(production.resourceNames),
      production.vars.PUBLIC_STOREFRONT_ORIGIN,
      production.vars.ADMIN_ORIGIN,
      ...production.requiredSecrets,
    ];
    const commandEnvironment = {
      ...process.env,
      CLOUDFLARE_ENV: "production",
    } as NodeJS.ProcessEnv;

    const productionBuild = spawnSync("pnpm", ["build:production"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: commandEnvironment,
    });
    expect(productionBuild.status, productionBuild.stderr).toBe(0);

    const previewBuild = spawnSync("pnpm", ["build:preview"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: commandEnvironment,
    });
    expect(previewBuild.status, previewBuild.stderr).toBe(0);

    const generatedPreview = readFileSync(
      new URL("../build/server/wrangler.json", import.meta.url),
      "utf8",
    );
    expect(generatedPreview).toContain("hydraulic-hose-rfq-platform-preview");
    for (const identifier of productionIdentifiers) {
      expect(generatedPreview).not.toContain(identifier);
    }

    const localDryRun = spawnSync("pnpm", ["dry-run:local"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: commandEnvironment,
    });
    const localOutput = `${localDryRun.stdout}\n${localDryRun.stderr}`;
    expect(localDryRun.status, localOutput).toBe(0);
    expect(localOutput).toContain("hydraulic-hose-rfq-local");
    for (const identifier of productionIdentifiers) {
      expect(localOutput).not.toContain(identifier);
    }

    const generatedLocal = readFileSync(
      new URL("../build/server/wrangler.json", import.meta.url),
      "utf8",
    );
    expect(generatedLocal).toContain("hydraulic-hose-rfq-platform-local");
    for (const identifier of productionIdentifiers) {
      expect(generatedLocal).not.toContain(identifier);
    }
  }, 20_000);
});
