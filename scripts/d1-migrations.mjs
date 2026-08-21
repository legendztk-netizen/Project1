import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const wranglerBin = fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url));
const schemaContract = readJson("config/database-schema-contract.json");
const environmentContract = readJson("config/environment-contract.json");
const wrangler = readJson("wrangler.jsonc");
const environmentNames = ["local", "preview", "production"];

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, projectRoot), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resolvedWranglerEnvironment(environment) {
  if (environment === "local") return wrangler;
  return wrangler.env?.[environment];
}

function validateMigrationContract() {
  const migrationFiles = readdirSync(new URL("../migrations/", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const expectedMigrations = [...schemaContract.migrations].sort();
  assert(
    JSON.stringify(migrationFiles) === JSON.stringify(expectedMigrations),
    `Migration files do not match database-schema-contract.json. Expected ${expectedMigrations.join(", ")}; found ${migrationFiles.join(", ")}`,
  );
}

function databaseConfiguration(environment) {
  assert(environmentNames.includes(environment), `Unknown database environment: ${environment}`);
  validateMigrationContract();
  const definition = resolvedWranglerEnvironment(environment);
  assert(definition, `Wrangler environment ${environment} is missing`);
  const bindingName = environmentContract.bindingNames.database;
  const database = definition.d1_databases?.find((item) => item.binding === bindingName);
  assert(database, `${environment} is missing D1 binding ${bindingName}`);
  assert(
    database.database_name === environmentContract.environments[environment].resourceNames.database,
    `${environment} D1 name does not match the environment contract`,
  );
  if (environment !== "local") {
    assert(
      database.database_id && !database.database_id.includes("replace-with-"),
      `${environment} D1 database_id is still a placeholder`,
    );
  }
  return database;
}

function environmentArguments(environment) {
  if (environment === "local") {
    return [
      "--local",
      ...(process.env.D1_PERSIST_TO ? ["--persist-to", process.env.D1_PERSIST_TO] : []),
    ];
  }
  return ["--env", environment, "--remote"];
}

function runWrangler(environment, args, options = {}) {
  const database = databaseConfiguration(environment);
  const childEnvironment = { ...process.env };
  if (environment === "local") delete childEnvironment.CLOUDFLARE_ENV;
  else childEnvironment.CLOUDFLARE_ENV = environment;
  return execFileSync(
    wranglerBin,
    [...args, database.database_name, ...environmentArguments(environment)],
    {
      cwd: fileURLToPath(projectRoot),
      encoding: "utf8",
      env: childEnvironment,
      ...options,
    },
  );
}

function query(environment, statement) {
  const output = runWrangler(
    environment,
    ["d1", "execute", "--command", statement, "--json"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const result = JSON.parse(output);
  assert(result[0]?.success === true, `D1 verification query failed for ${environment}`);
  return result[0].results;
}

function verifyDatabase(environment) {
  const migrationRows = query(
    environment,
    "SELECT name FROM d1_migrations ORDER BY id",
  );
  const appliedMigrations = migrationRows.map(({ name }) => name);
  const missingMigrations = schemaContract.migrations.filter(
    (migration) => !appliedMigrations.includes(migration),
  );
  assert(
    missingMigrations.length === 0,
    `${environment} D1 is missing migrations: ${missingMigrations.join(", ")}`,
  );

  const schemaRows = query(
    environment,
    "SELECT version FROM application_schema_state WHERE singleton = 1",
  );
  const currentVersion = schemaRows[0]?.version;
  assert(
    currentVersion === schemaContract.schemaVersion,
    `${environment} D1 schema version ${String(currentVersion)} does not match expected version ${schemaContract.schemaVersion}`,
  );
  process.stdout.write(
    `database=${environment} schemaVersion=${currentVersion} migrations=${appliedMigrations.length} readiness=ready\n`,
  );
}

function applyMigrations(environment) {
  const output = runWrangler(environment, ["d1", "migrations", "apply"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  process.stdout.write(output);
  verifyDatabase(environment);
}

const [, , command, environment] = process.argv;

try {
  if (command === "apply") applyMigrations(environment);
  else if (command === "verify") verifyDatabase(environment);
  else {
    throw new Error("Usage: d1-migrations.mjs <apply|verify> <local|preview|production>");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[d1-migrations] ${message}\n`);
  process.exitCode = 1;
}

export { applyMigrations, verifyDatabase };
