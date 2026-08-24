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

async function startHealthWorker(fixture: ReturnType<typeof createD1Fixture>) {
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
      return { response: await fetch(origin), worker };
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
  }, 30_000);

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
