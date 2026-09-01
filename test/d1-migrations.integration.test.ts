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
  it("transactionally merges anonymous Quote Lists into one account-owned list", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "hose-d1-account-quote-merge-"),
    );
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
    const database = platform.env.DB;
    const now = "2026-09-01T00:10:00.000Z";
    const future = "2026-10-01T00:00:00.000Z";

    async function seedSql(sql: string) {
      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => database.prepare(statement));
      await database.batch(statements);
    }

    async function seedChallenge(
      id: string,
      email: string,
      createdAt: string,
      sourceSessionId: string,
    ) {
      await database
        .prepare(
          `INSERT INTO customer_otp_challenges
             (id, email_normalized, purpose, otp_digest, request_ip_digest,
              created_at, expires_at, delivery_status,
              quote_session_id_at_request)
           VALUES (?, ?, 'register', 'digest', ?, ?, ?, 'delivered', ?)`,
        )
        .bind(id, email, `ip-${id}`, createdAt, future, sourceSessionId)
        .run();
    }

    async function complete(input: {
      challengeId: string;
      email: string;
      profileId: string;
      sourceSessionId: string;
      suffix: string;
    }) {
      return createD1CustomerIdentityRepository(database).completeVerification({
        anonymousQuoteSessionId: input.sourceSessionId,
        authenticate: true,
        challengeId: input.challengeId,
        email: input.email,
        expiresAt: future,
        now,
        previousTokenDigest: null,
        profileId: input.profileId,
        quoteListDestinationSessionId: `destination-${input.suffix}`,
        quoteListMergeId: `merge-${input.suffix}`,
        sessionId: `customer-session-${input.suffix}`,
        tokenDigest: `customer-token-${input.suffix}`,
      });
    }

    try {
      await seedSql(
        `INSERT INTO catalog_imports
           (id, kind, status, summary_json, error_count, warning_count,
            created_at, completed_at)
         VALUES ('merge-import', 'diagnostic', 'completed', '{}', 0, 0,
                 '${now}', '${now}');
         INSERT INTO catalog_releases
           (id, release_number, status, source_import_id, version, created_at,
            published_at)
         VALUES ('merge-release', 'MERGE-1', 'published', 'merge-import', 1,
                 '${now}', '${now}');
         INSERT INTO customer_profiles
           (id, email_normalized, email_display, email_verified_at,
            created_at, updated_at)
         VALUES ('profile-main', 'merge@example.com', 'merge@example.com',
                 '${now}', '${now}', '${now}');
         INSERT INTO anonymous_quote_sessions
           (id, created_at, last_activity_at, expires_at, profile_id)
         VALUES ('destination-main', '${now}', '${now}',
                 '9999-12-31T23:59:59.999Z', 'profile-main');
         INSERT INTO anonymous_quote_sessions
           (id, created_at, last_activity_at, expires_at)
         VALUES ('source-main', '${now}', '${now}', '${future}');`,
      );

      const commonColumns = `
        id, session_id, line_identity, sku, catalog_release_id, display_name,
        category, line_kind, quantity, sales_unit, currency,
        reference_unit_price, created_at, updated_at`;
      await seedSql(
        `INSERT INTO anonymous_quote_lines (${commonColumns}) VALUES
           ('dest-standard', 'destination-main', 'standard:SKU-A', 'SKU-A',
            'merge-release', 'Standard A', 'hose-ends', 'standard', 2, 'each',
            'USD', 4, '${now}', '${now}'),
           ('source-standard', 'source-main', 'standard:SKU-A', 'SKU-A',
            'merge-release', 'Standard A old', 'hose-ends', 'standard', 3,
            'each', 'USD', 5, '${now}', '${now}'),
           ('source-standard-unique', 'source-main', 'standard:SKU-B', 'SKU-B',
            'merge-release', 'Standard B', 'hose-ends', 'standard', 4, 'each',
            'USD', 6, '${now}', '${now}');
         INSERT INTO anonymous_quote_lines
           (${commonColumns}, original_length_value, original_length_unit,
            normalized_length_ft, piece_count, total_footage,
            cutting_labeling_fee_rate, cutting_labeling_fee_amount,
            cutting_labeling_fee_scope, cutting_labeling_fee_version,
            estimated_merchandise_amount, current_estimate_amount)
         VALUES
           ('dest-length', 'destination-main', 'length-hose:HOSE-A:10ft',
            'HOSE-A', 'merge-release', 'Hose A 10 ft', 'hydraulic-hose',
            'length_based_hose', 1, 'ft', 'USD', 2, '${now}', '${now}',
            10, 'ft', 10, 1, 10, 1, 1, 'per_piece', 1, 20, 21),
           ('source-length', 'source-main', 'length-hose:HOSE-A:10ft',
            'HOSE-A', 'merge-release', 'Hose A old 10 ft', 'hydraulic-hose',
            'length_based_hose', 2, 'ft', 'USD', 3, '${now}', '${now}',
            10, 'ft', 10, 2, 20, 2, 4, 'per_piece', 2, 60, 64),
           ('source-length-unique', 'source-main', 'length-hose:HOSE-A:20ft',
            'HOSE-A', 'merge-release', 'Hose A 20 ft', 'hydraulic-hose',
            'length_based_hose', 1, 'ft', 'USD', 3, '${now}', '${now}',
            20, 'ft', 20, 1, 20, 2, 2, 'per_piece', 2, 60, 62);
         INSERT INTO anonymous_quote_lines
           (${commonColumns}, current_estimate_amount, configured_snapshot_json,
            configured_estimate_inputs_json, configured_unit_estimate_amount)
         VALUES
           ('dest-configured', 'destination-main', 'configured:shared',
            'HOSE-A', 'merge-release', 'Configured A', 'hydraulic-hose',
            'configured_assembly', 1, 'each', 'USD', NULL, '${now}', '${now}',
            12, '{"context":"destination"}', '{"priceVersion":1}', 12),
           ('source-configured', 'source-main', 'configured:shared',
            'HOSE-A', 'merge-release', 'Configured A old', 'hydraulic-hose',
            'configured_assembly', 2, 'each', 'USD', NULL, '${now}', '${now}',
            40, '{"context":"source"}', '{"priceVersion":2}', 20),
           ('source-configured-unique', 'source-main', 'configured:unique',
            'HOSE-A', 'merge-release', 'Configured B', 'hydraulic-hose',
            'configured_assembly', 1, 'each', 'USD', NULL, '${now}', '${now}',
            15, '{"context":"unique"}', '{"priceVersion":3}', 15);`,
      );
      await seedChallenge(
        "challenge-main",
        "merge@example.com",
        "2026-09-01T00:00:00.000Z",
        "source-main",
      );

      const first = await complete({
        challengeId: "challenge-main",
        email: "merge@example.com",
        profileId: "profile-main",
        sourceSessionId: "source-main",
        suffix: "main",
      });
      expect(first).toMatchObject({ consumed: true, quoteListMerged: true });

      const merged = await database
        .prepare(
          `SELECT id, line_identity, quantity, piece_count, total_footage,
                  cutting_labeling_fee_amount, estimated_merchandise_amount,
                  current_estimate_amount, configured_snapshot_json,
                  configured_estimate_inputs_json,
                  configured_unit_estimate_amount, original_length_value,
                  original_length_unit
           FROM anonymous_quote_lines WHERE session_id = 'destination-main'
           ORDER BY line_identity`,
        )
        .all<{
          configured_snapshot_json: string | null;
          configured_estimate_inputs_json: string | null;
          configured_unit_estimate_amount: number | null;
          current_estimate_amount: number | null;
          cutting_labeling_fee_amount: number | null;
          estimated_merchandise_amount: number | null;
          id: string;
          line_identity: string;
          original_length_unit: string | null;
          original_length_value: number | null;
          piece_count: number | null;
          quantity: number;
          total_footage: number | null;
        }>();
      expect(merged.results).toHaveLength(6);
      expect(
        merged.results.find((line) => line.line_identity === "standard:SKU-A"),
      ).toMatchObject({ id: "dest-standard", quantity: 5 });
      expect(
        merged.results.find(
          (line) => line.line_identity === "length-hose:HOSE-A:10ft",
        ),
      ).toMatchObject({
        current_estimate_amount: 63,
        cutting_labeling_fee_amount: 3,
        estimated_merchandise_amount: 60,
        id: "dest-length",
        piece_count: 3,
        quantity: 3,
        total_footage: 30,
      });
      expect(
        merged.results.find(
          (line) => line.line_identity === "configured:shared",
        ),
      ).toMatchObject({
        configured_snapshot_json: '{"context":"destination"}',
        configured_unit_estimate_amount: 12,
        current_estimate_amount: 36,
        id: "dest-configured",
        quantity: 3,
      });
      expect(
        merged.results.find((line) => line.line_identity === "standard:SKU-B"),
      ).toMatchObject({ id: "source-standard-unique", quantity: 4 });
      expect(
        merged.results.find(
          (line) => line.line_identity === "length-hose:HOSE-A:20ft",
        ),
      ).toMatchObject({
        current_estimate_amount: 62,
        id: "source-length-unique",
        original_length_unit: "ft",
        original_length_value: 20,
        quantity: 1,
      });
      expect(
        merged.results.find(
          (line) => line.line_identity === "configured:unique",
        ),
      ).toMatchObject({
        configured_estimate_inputs_json: '{"priceVersion":3}',
        configured_snapshot_json: '{"context":"unique"}',
        current_estimate_amount: 15,
        id: "source-configured-unique",
        quantity: 1,
      });

      const source = await database
        .prepare(
          `SELECT retired_at, merged_into_session_id,
             (SELECT COUNT(*) FROM anonymous_quote_lines
              WHERE session_id = 'source-main') AS remaining_lines
           FROM anonymous_quote_sessions WHERE id = 'source-main'`,
        )
        .first<{
          merged_into_session_id: string;
          remaining_lines: number;
          retired_at: string;
        }>();
      expect(source).toEqual({
        merged_into_session_id: "destination-main",
        remaining_lines: 0,
        retired_at: now,
      });

      const audit = await database
        .prepare(
          `SELECT result_json FROM customer_quote_list_merges
           WHERE source_session_id = 'source-main'`,
        )
        .first<{ result_json: string }>();
      const result = JSON.parse(audit?.result_json ?? "{}") as {
        combinedLineCount: number;
        lines: Array<{
          finalDestinationLineId: string;
          finalQuantity: number;
          lineIdentity: string;
          sourceRetainedContext: Record<string, unknown>;
        }>;
        movedLineCount: number;
        sourceLineCount: number;
      };
      expect(result).toMatchObject({
        combinedLineCount: 3,
        movedLineCount: 3,
        sourceLineCount: 6,
      });
      expect(
        result.lines.find((line) => line.lineIdentity === "configured:shared"),
      ).toMatchObject({
        finalDestinationLineId: "dest-configured",
        finalQuantity: 3,
        sourceRetainedContext: {
          configuredEstimateInputs: { priceVersion: 2 },
          configuredSnapshot: { context: "source" },
          configuredUnitEstimateAmount: 20,
          currentEstimateAmount: 40,
        },
      });
      expect(
        result.lines.find(
          (line) => line.lineIdentity === "length-hose:HOSE-A:10ft",
        ),
      ).toMatchObject({
        finalDestinationLineId: "dest-length",
        finalQuantity: 3,
        sourceRetainedContext: {
          cuttingLabelingFeeAmount: 4,
          cuttingLabelingFeeRate: 2,
          cuttingLabelingFeeScope: "per_piece",
          cuttingLabelingFeeVersion: 2,
          estimatedMerchandiseAmount: 60,
          normalizedLengthFt: 10,
          originalLengthUnit: "ft",
          originalLengthValue: 10,
          pieceCount: 2,
          totalFootage: 20,
        },
      });

      const retry = await complete({
        challengeId: "challenge-main",
        email: "merge@example.com",
        profileId: "profile-main",
        sourceSessionId: "source-main",
        suffix: "retry",
      });
      expect(retry).toEqual({ consumed: false, profile: null });
      expect(
        (
          await database
            .prepare(
              `SELECT quantity FROM anonymous_quote_lines
               WHERE id = 'dest-standard'`,
            )
            .first<{ quantity: number }>()
        )?.quantity,
      ).toBe(5);

      await seedSql(
        `INSERT INTO anonymous_quote_sessions
           (id, created_at, last_activity_at, expires_at)
         VALUES ('source-empty', '${now}', '${now}', '${future}');`,
      );
      await seedChallenge(
        "challenge-empty",
        "merge@example.com",
        "2026-09-01T00:02:00.000Z",
        "source-empty",
      );
      const empty = await complete({
        challengeId: "challenge-empty",
        email: "merge@example.com",
        profileId: "profile-main",
        sourceSessionId: "source-empty",
        suffix: "empty",
      });
      expect(empty).toMatchObject({ consumed: true, quoteListMerged: true });
      const emptyAudit = await database
        .prepare(
          `SELECT result_json FROM customer_quote_list_merges
           WHERE source_session_id = 'source-empty'`,
        )
        .first<{ result_json: string }>();
      expect(JSON.parse(emptyAudit?.result_json ?? "{}")).toMatchObject({
        combinedLineCount: 0,
        movedLineCount: 0,
        sourceLineCount: 0,
      });

      await seedSql(
        `INSERT INTO anonymous_quote_sessions
           (id, created_at, last_activity_at, expires_at)
         VALUES ('source-unrelated', '${now}', '${now}', '${future}');`,
      );
      await seedChallenge(
        "challenge-unrelated",
        "merge@example.com",
        "2026-09-01T00:04:00.000Z",
        "source-main",
      );
      const unrelated = await complete({
        challengeId: "challenge-unrelated",
        email: "merge@example.com",
        profileId: "profile-main",
        sourceSessionId: "source-unrelated",
        suffix: "unrelated",
      });
      expect(unrelated).toMatchObject({
        consumed: true,
        quoteListMerged: false,
      });
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count FROM customer_quote_list_merges
             WHERE source_session_id = 'source-unrelated'`,
          )
          .first<{ count: number }>(),
      ).toEqual({ count: 0 });
      expect(
        await database
          .prepare(
            `SELECT retired_at, merged_into_session_id
             FROM anonymous_quote_sessions WHERE id = 'source-unrelated'`,
          )
          .first(),
      ).toEqual({ merged_into_session_id: null, retired_at: null });

      await seedSql(
        `INSERT INTO anonymous_quote_sessions
           (id, created_at, last_activity_at, expires_at)
         VALUES ('source-overflow', '${now}', '${now}', '${future}');
         INSERT INTO anonymous_quote_lines (${commonColumns}) VALUES
           ('source-overflow-line', 'source-overflow', 'standard:SKU-A',
            'SKU-A', 'merge-release', 'Standard A overflow', 'hose-ends',
            'standard', 9999, 'each', 'USD', 4, '${now}', '${now}');`,
      );
      await seedChallenge(
        "challenge-overflow",
        "merge@example.com",
        "2026-09-01T00:06:00.000Z",
        "source-overflow",
      );
      const overflow = await complete({
        challengeId: "challenge-overflow",
        email: "merge@example.com",
        profileId: "profile-main",
        sourceSessionId: "source-overflow",
        suffix: "overflow",
      });
      expect(overflow).toMatchObject({
        consumed: true,
        quoteListMerged: false,
      });
      expect(
        await database
          .prepare(
            `SELECT quantity FROM anonymous_quote_lines
             WHERE id = 'dest-standard'`,
          )
          .first(),
      ).toEqual({ quantity: 5 });
      expect(
        await database
          .prepare(
            `SELECT quantity FROM anonymous_quote_lines
             WHERE id = 'source-overflow-line'`,
          )
          .first(),
      ).toEqual({ quantity: 9999 });
      expect(
        await database
          .prepare(
            `SELECT retired_at, merged_into_session_id
             FROM anonymous_quote_sessions WHERE id = 'source-overflow'`,
          )
          .first(),
      ).toEqual({ merged_into_session_id: null, retired_at: null });
    } finally {
      await platform.dispose();
    }
  }, 60_000);

  it("keeps the newest delivered OTP active and rejects repeated delivery", async () => {
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
      await expect(
        repository.activateDeliveredChallenge({
          deliveredAt: "2026-09-01T00:01:04.000Z",
          email: common.email,
          id: "older-delayed",
          purpose: common.purpose,
        }),
      ).rejects.toThrow("OTP challenge delivery could not be activated");

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
