import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";

import { createD1CustomerIdentityRepository } from "../app/modules/customer-identity/infrastructure/d1-customer-identity-repository";

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
}

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const wranglerBin = join(projectRoot, "node_modules", ".bin", "wrangler");
const schemaContract = JSON.parse(
  readFileSync(
    join(projectRoot, "config", "database-schema-contract.json"),
    "utf8",
  ),
) as { migrations: string[]; schemaVersion: number };
const temporaryDirectories: string[] = [];

function createD1Fixture(includeBrokenMigration = false) {
  const directory = mkdtempSync(join(tmpdir(), "hose-d1-ticket03-"));
  temporaryDirectories.push(directory);
  const migrationsDirectory = join(directory, "migrations");
  const persistenceDirectory = join(directory, "state");
  mkdirSync(migrationsDirectory);

  for (const migration of schemaContract.migrations) {
    copyFileSync(
      join(projectRoot, "migrations", migration),
      join(migrationsDirectory, migration),
    );
  }

  const expectedMigrations = [...schemaContract.migrations];
  if (includeBrokenMigration) {
    const brokenMigration = "9999_intentionally_broken.sql";
    writeFileSync(
      join(migrationsDirectory, brokenMigration),
      "INSERT INTO table_that_does_not_exist (id) VALUES (1);\n",
    );
    expectedMigrations.push(brokenMigration);
  }

  const configPath = join(directory, "wrangler.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        compatibility_date: "2026-08-15",
        compatibility_flags: ["nodejs_compat"],
        d1_databases: [
          {
            binding: "DB",
            database_name: "ticket03-real-local-d1",
            migrations_dir: migrationsDirectory,
          },
        ],
        main: join(projectRoot, "test", "fixtures", "schema-health-worker.ts"),
        name: "ticket03-schema-health-fixture",
        vars: {
          APP_ENV: "local",
          TEST_EXPECTED_MIGRATIONS: JSON.stringify(expectedMigrations),
          TEST_EXPECTED_SCHEMA_VERSION: String(schemaContract.schemaVersion),
        },
      },
      null,
      2,
    ),
  );

  return {
    configPath,
    directory,
    expectedMigrations,
    persistenceDirectory,
  };
}

function runWrangler(
  fixture: ReturnType<typeof createD1Fixture>,
  args: string[],
) {
  return spawnSync(
    wranglerBin,
    [
      ...args,
      "--config",
      fixture.configPath,
      "--local",
      "--persist-to",
      fixture.persistenceDirectory,
    ],
    {
      cwd: fixture.directory,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    },
  );
}

function applyMigrations(fixture: ReturnType<typeof createD1Fixture>) {
  return runWrangler(fixture, ["d1", "migrations", "apply", "DB"]);
}

function runProjectMigrate(persistenceDirectory: string) {
  return spawnSync("pnpm", ["migrate"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_ENV: "production",
      D1_PERSIST_TO: persistenceDirectory,
    } as NodeJS.ProcessEnv,
  });
}

function queryProjectD1<T>(persistenceDirectory: string, sql: string) {
  const result = spawnSync(
    wranglerBin,
    [
      "d1",
      "execute",
      "hydraulic-hose-rfq-local",
      "--config",
      join(projectRoot, "wrangler.jsonc"),
      "--local",
      "--persist-to",
      persistenceDirectory,
      "--command",
      sql,
      "--json",
    ],
    { cwd: projectRoot, encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const payload = JSON.parse(result.stdout) as Array<D1QueryResult<T>>;
  expect(payload[0]?.success).toBe(true);
  return payload[0]?.results ?? [];
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function runDeploymentChainAfterMigration(
  fixture: ReturnType<typeof createD1Fixture>,
) {
  const marker = join(fixture.directory, "deployment-stage-ran");
  const deploymentStage = join(fixture.directory, "deployment-stage.mjs");
  writeFileSync(
    deploymentStage,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\n`,
  );
  const migrationCommand = [
    shellQuote(wranglerBin),
    "d1 migrations apply DB",
    "--config",
    shellQuote(fixture.configPath),
    "--local --persist-to",
    shellQuote(fixture.persistenceDirectory),
  ].join(" ");
  const deploymentCommand = `${shellQuote(process.execPath)} ${shellQuote(deploymentStage)}`;
  const result = spawnSync(
    "/bin/sh",
    ["-c", `${migrationCommand} && ${deploymentCommand}`],
    {
      cwd: fixture.directory,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    },
  );
  return { marker, result };
}

function queryD1<T>(fixture: ReturnType<typeof createD1Fixture>, sql: string) {
  const result = runWrangler(fixture, [
    "d1",
    "execute",
    "DB",
    "--command",
    sql,
    "--json",
  ]);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const payload = JSON.parse(result.stdout) as Array<D1QueryResult<T>>;
  expect(payload[0]?.success).toBe(true);
  return payload[0]?.results ?? [];
}

async function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function startHealthWorker(
  fixture: ReturnType<typeof createD1Fixture>,
  path = "",
) {
  const port = await findAvailablePort();
  const output: string[] = [];
  const worker = spawn(
    wranglerBin,
    [
      "dev",
      "--config",
      fixture.configPath,
      "--persist-to",
      fixture.persistenceDirectory,
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: fixture.directory, env: { ...process.env, CI: "1" }, stdio: "pipe" },
  );
  worker.stdout?.on("data", (chunk) => output.push(String(chunk)));
  worker.stderr?.on("data", (chunk) => output.push(String(chunk)));

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`Health fixture exited early:\n${output.join("")}`);
    }
    try {
      return { response: await fetch(`${origin}${path}`), worker };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  worker.kill("SIGTERM");
  throw new Error(`Health fixture did not start:\n${output.join("")}`);
}

async function stopWorker(worker: ChildProcess) {
  if (worker.exitCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    worker.once("exit", () => resolve()),
  );
  worker.kill("SIGTERM");
  await exited;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("real local D1 migration lifecycle", () => {
  it("keeps the newest delivered OTP active when email delivery completes out of order", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hose-d1-otp-ordering-"));
    temporaryDirectories.push(directory);
    const migration = runProjectMigrate(directory);
    expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(
      0,
    );
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: join(projectRoot, "wrangler.jsonc"),
      persist: { path: join(directory, "v3") },
      remoteBindings: false,
    });

    try {
      const repository = createD1CustomerIdentityRepository(platform.env.DB);
      const common = {
        digest: "test-only-digest",
        email: "delayed-delivery@example.com",
        expiresAt: "2026-09-01T01:00:00.000Z",
        ipDigest: "test-only-ip-digest",
        purpose: "register" as const,
      };
      await repository.createChallenge({
        ...common,
        createdAt: "2026-09-01T00:00:00.000Z",
        id: "older-delayed",
      });
      await repository.createChallenge({
        ...common,
        createdAt: "2026-09-01T00:01:01.000Z",
        id: "newer-first",
      });
      await repository.activateDeliveredChallenge({
        deliveredAt: "2026-09-01T00:01:02.000Z",
        email: common.email,
        id: "newer-first",
        purpose: common.purpose,
      });
      await platform.env.DB.prepare(
        `UPDATE customer_otp_challenges SET consumed_at = ? WHERE id = ?`,
      )
        .bind("2026-09-01T00:01:02.500Z", "newer-first")
        .run();
      await repository.activateDeliveredChallenge({
        deliveredAt: "2026-09-01T00:01:03.000Z",
        email: common.email,
        id: "older-delayed",
        purpose: common.purpose,
      });

      const rows = await platform.env.DB.prepare(
        `SELECT id, delivery_status, consumed_at, superseded_at
         FROM customer_otp_challenges ORDER BY rowid`,
      ).all<{
        consumed_at: string | null;
        delivery_status: string;
        id: string;
        superseded_at: string | null;
      }>();
      expect(rows.results).toEqual([
        {
          consumed_at: null,
          delivery_status: "delivered",
          id: "older-delayed",
          superseded_at: "2026-09-01T00:01:03.000Z",
        },
        {
          consumed_at: "2026-09-01T00:01:02.500Z",
          delivery_status: "delivered",
          id: "newer-first",
          superseded_at: null,
        },
      ]);
    } finally {
      await platform.dispose();
    }
  }, 30_000);

  it("runs pnpm migrate twice against one local D1 without duplicate schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "hose-d1-command-isolation-"));
    temporaryDirectories.push(directory);
    const first = runProjectMigrate(directory);
    const firstOutput = `${first.stdout}\n${first.stderr}`;
    const second = runProjectMigrate(directory);
    const secondOutput = `${second.stdout}\n${second.stderr}`;

    expect(first.status, firstOutput).toBe(0);
    expect(second.status, secondOutput).toBe(0);
    expect(firstOutput).toContain("database=local");
    expect(secondOutput).toContain("No migrations to apply");
    expect(`${firstOutput}\n${secondOutput}`).not.toContain(
      "hydraulic-hose-rfq-production",
    );

    const migrations = queryProjectD1<{ name: string }>(
      directory,
      "SELECT name FROM d1_migrations ORDER BY id",
    );
    expect(migrations.map(({ name }) => name)).toEqual(
      schemaContract.migrations,
    );

    const expectedTables = [
      "admin_audit_events",
      "admin_identities",
      "application_schema_state",
      "catalog_active_release",
      "catalog_imports",
      "catalog_release_publications",
      "catalog_releases",
      "d1_migrations",
    ];
    const tables = queryProjectD1<{ name: string }>(
      directory,
      `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${expectedTables.map((name) => `'${name}'`).join(", ")}) ORDER BY name`,
    );
    expect(tables.map(({ name }) => name)).toEqual(expectedTables);
  }, 60_000);

  it("applies the same migration command twice without duplicate schema or migration rows", () => {
    const fixture = createD1Fixture();

    const first = applyMigrations(fixture);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const second = applyMigrations(fixture);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);

    const migrations = queryD1<{ name: string }>(
      fixture,
      "SELECT name FROM d1_migrations ORDER BY id",
    );
    expect(migrations.map(({ name }) => name)).toEqual(
      schemaContract.migrations,
    );

    const tables = queryD1<{ name: string }>(
      fixture,
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "admin_identities",
        "admin_audit_events",
        "application_schema_state",
        "catalog_active_release",
        "catalog_imports",
        "catalog_release_publications",
        "catalog_releases",
        "d1_migrations",
      ]),
    );

    const mixedCaseIdentity = runWrangler(fixture, [
      "d1",
      "execute",
      "DB",
      "--command",
      `INSERT INTO admin_identities
       (id, email, account_type, status, created_at, updated_at)
       VALUES ('mixed-case', 'Owner@Example.com', 'owner', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ]);
    expect(mixedCaseIdentity.status).not.toBe(0);
    expect(
      `${mixedCaseIdentity.stdout}\n${mixedCaseIdentity.stderr}`,
    ).toContain("admin_identity_email_lowercase");
  }, 30_000);

  it("adds registry seeds only to pre-existing draft releases during an upgrade", () => {
    const fixture = createD1Fixture();
    const registryMigration = "0013_configurator_reference_registries.sql";
    const diagramVersionMigration =
      "0014_version_measurement_diagram_assets.sql";
    const protectionPricingMigration =
      "0015_length_based_protection_pricing.sql";
    rmSync(join(fixture.directory, "migrations", registryMigration));
    rmSync(join(fixture.directory, "migrations", diagramVersionMigration));
    rmSync(join(fixture.directory, "migrations", protectionPricingMigration));
    const preRegistryMigration = applyMigrations(fixture);
    expect(
      preRegistryMigration.status,
      `${preRegistryMigration.stdout}\n${preRegistryMigration.stderr}`,
    ).toBe(0);

    queryD1(
      fixture,
      `INSERT INTO catalog_imports
         (id, kind, status, summary_json, error_count, warning_count, created_at, completed_at)
       VALUES
         ('upgrade-import-published', 'diagnostic', 'completed', '{}', 0, 0,
          '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z'),
         ('upgrade-import-draft', 'diagnostic', 'completed', '{}', 0, 0,
          '2026-08-25T00:01:00.000Z', '2026-08-25T00:01:00.000Z');
       INSERT INTO catalog_releases
         (id, release_number, status, source_import_id, version, created_at, published_at)
       VALUES
         ('upgrade-release-published', 'UPGRADE-PUBLISHED', 'published',
          'upgrade-import-published', 1, '2026-08-25T00:00:00.000Z',
          '2026-08-25T00:00:30.000Z'),
         ('upgrade-release-draft', 'UPGRADE-DRAFT', 'draft',
          'upgrade-import-draft', 1, '2026-08-25T00:01:00.000Z', NULL);`,
    );

    copyFileSync(
      join(projectRoot, "migrations", registryMigration),
      join(fixture.directory, "migrations", registryMigration),
    );
    copyFileSync(
      join(projectRoot, "migrations", diagramVersionMigration),
      join(fixture.directory, "migrations", diagramVersionMigration),
    );
    copyFileSync(
      join(projectRoot, "migrations", protectionPricingMigration),
      join(fixture.directory, "migrations", protectionPricingMigration),
    );
    const registryUpgrade = applyMigrations(fixture);
    expect(
      registryUpgrade.status,
      `${registryUpgrade.stdout}\n${registryUpgrade.stderr}`,
    ).toBe(0);

    expect(
      queryD1<{ count: number; release_id: string }>(
        fixture,
        `SELECT release_id, COUNT(*) AS count
         FROM catalog_configurator_registry_entries
         GROUP BY release_id ORDER BY release_id`,
      ),
    ).toEqual([{ count: 25, release_id: "upgrade-release-draft" }]);
  }, 30_000);

  it("selects active and historical registry versions and locks published history", async () => {
    const fixture = createD1Fixture();
    const migrated = applyMigrations(fixture);
    expect(migrated.status, `${migrated.stdout}\n${migrated.stderr}`).toBe(0);

    expect(
      queryD1<{ count: number }>(
        fixture,
        `SELECT COUNT(*) AS count
         FROM catalog_configurator_registry_entries entry
         INNER JOIN catalog_releases release ON release.id = entry.release_id
         WHERE release.status IN ('published', 'superseded')`,
      ),
    ).toEqual([{ count: 0 }]);

    queryD1(
      fixture,
      `INSERT INTO catalog_imports
         (id, kind, status, summary_json, error_count, warning_count, created_at, completed_at)
       VALUES
         ('registry-import-1', 'diagnostic', 'completed', '{}', 0, 0,
          '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
       INSERT INTO catalog_releases
         (id, release_number, status, source_import_id, version, created_at)
       VALUES
         ('registry-release-1', 'REGISTRY-1', 'draft', 'registry-import-1', 1,
          '2026-08-25T00:00:00.000Z');`,
    );

    const counts = queryD1<{ count: number; registry_type: string }>(
      fixture,
      `SELECT registry_type, COUNT(*) AS count
       FROM catalog_configurator_registry_entries
       WHERE release_id = 'registry-release-1'
       GROUP BY registry_type ORDER BY registry_type`,
    );
    expect(counts).toEqual([
      { count: 1, registry_type: "assembly_estimate_schedule" },
      { count: 1, registry_type: "clocking_convention" },
      { count: 6, registry_type: "endpoint_class" },
      { count: 3, registry_type: "installed_protection" },
      { count: 7, registry_type: "measurement_mapping" },
      { count: 7, registry_type: "measurement_method" },
    ]);

    queryD1(
      fixture,
      `UPDATE catalog_configurator_registry_entries
       SET payload_json = json_set(payload_json, '$.assemblyServicePriceUsd', 12.5),
           record_version = record_version + 1
       WHERE release_id = 'registry-release-1'
         AND registry_type = 'assembly_estimate_schedule'
         AND entry_key = 'DEFAULT';
       UPDATE catalog_releases
       SET status = 'published', published_at = '2026-08-25T01:00:00.000Z',
           version = version + 1
       WHERE id = 'registry-release-1';`,
    );

    const published = queryD1<{
      price: number;
      record_version: number;
    }>(
      fixture,
      `SELECT json_extract(payload_json, '$.assemblyServicePriceUsd') AS price,
              record_version
       FROM catalog_configurator_registry_entries
       WHERE release_id = 'registry-release-1'
         AND registry_type = 'assembly_estimate_schedule'`,
    );
    expect(published).toEqual([{ price: 12.5, record_version: 2 }]);

    const forbiddenUpdate = runWrangler(fixture, [
      "d1",
      "execute",
      "DB",
      "--command",
      `UPDATE catalog_configurator_registry_entries
       SET payload_json = json_set(payload_json, '$.assemblyServicePriceUsd', 99)
       WHERE release_id = 'registry-release-1'
         AND registry_type = 'assembly_estimate_schedule'`,
    ]);
    expect(forbiddenUpdate.status).not.toBe(0);
    expect(`${forbiddenUpdate.stdout}\n${forbiddenUpdate.stderr}`).toContain(
      "published configurator registry is immutable",
    );

    queryD1(
      fixture,
      `INSERT INTO catalog_imports
         (id, kind, status, summary_json, error_count, warning_count, created_at, completed_at)
       VALUES
         ('registry-import-2', 'diagnostic', 'completed', '{}', 0, 0,
          '2026-08-25T02:00:00.000Z', '2026-08-25T02:00:00.000Z');
       INSERT INTO catalog_releases
         (id, release_number, status, source_import_id, version, created_at)
       VALUES
         ('registry-release-2', 'REGISTRY-2', 'draft', 'registry-import-2', 1,
          '2026-08-25T02:00:00.000Z');
       UPDATE catalog_configurator_registry_entries
       SET payload_json = json_set(payload_json, '$.assemblyServicePriceUsd', 99),
           record_version = record_version + 1
       WHERE release_id = 'registry-release-2'
         AND registry_type = 'assembly_estimate_schedule';
       UPDATE catalog_releases
       SET status = 'superseded'
       WHERE id = 'registry-release-1';
       UPDATE catalog_releases
       SET status = 'published', published_at = '2026-08-25T03:00:00.000Z',
           version = version + 1
       WHERE id = 'registry-release-2';
       UPDATE catalog_active_release
       SET release_id = 'registry-release-2', version = version + 1,
           updated_at = '2026-08-25T02:00:00.000Z'
       WHERE singleton = 1;`,
    );

    const activeWorker = await startHealthWorker(
      fixture,
      "/configurator-reference/active",
    );
    try {
      expect(activeWorker.response.status).toBe(200);
      await expect(activeWorker.response.json()).resolves.toMatchObject({
        snapshot: {
          assemblyEstimateSchedule: { assemblyServicePriceUsd: 99 },
          release: { id: "registry-release-2", status: "published" },
        },
      });
    } finally {
      await stopWorker(activeWorker.worker);
    }

    const historicalWorker = await startHealthWorker(
      fixture,
      "/configurator-reference/active?release=registry-release-1",
    );
    try {
      expect(historicalWorker.response.status).toBe(200);
      await expect(historicalWorker.response.json()).resolves.toMatchObject({
        snapshot: {
          assemblyEstimateSchedule: { assemblyServicePriceUsd: 12.5 },
          release: { id: "registry-release-1", status: "superseded" },
        },
      });
    } finally {
      await stopWorker(historicalWorker.worker);
    }
  }, 60_000);

  it("rolls back a broken migration and makes the real Worker health check fail closed", async () => {
    const fixture = createD1Fixture(true);
    const { marker, result: deploymentChain } =
      runDeploymentChainAfterMigration(fixture);
    expect(deploymentChain.status).not.toBe(0);
    expect(`${deploymentChain.stdout}\n${deploymentChain.stderr}`).toContain(
      "table_that_does_not_exist",
    );
    expect(existsSync(marker)).toBe(false);

    const migrations = queryD1<{ name: string }>(
      fixture,
      "SELECT name FROM d1_migrations ORDER BY id",
    );
    expect(migrations.map(({ name }) => name)).toEqual(
      schemaContract.migrations,
    );
    expect(migrations.map(({ name }) => name)).not.toContain(
      "9999_intentionally_broken.sql",
    );

    const { response, worker } = await startHealthWorker(fixture);
    try {
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        database: { missingMigrations: ["9999_intentionally_broken.sql"] },
        status: "blocked",
      });
    } finally {
      await stopWorker(worker);
    }
  }, 30_000);
});
