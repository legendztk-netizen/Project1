import databaseSchemaContract from "../config/database-schema-contract.json";

export interface DatabaseSchemaContract {
  migrations: readonly string[];
  schemaVersion: number;
}

export interface DatabaseSchemaReadiness {
  appliedMigrations: string[];
  currentSchemaVersion: number | null;
  expectedSchemaVersion: number;
  missingMigrations: string[];
  ready: boolean;
  reason?: string;
}

export async function inspectDatabaseSchemaReadiness(
  database: D1Database,
  expected: DatabaseSchemaContract = databaseSchemaContract,
): Promise<DatabaseSchemaReadiness> {
  try {
    const [schemaState, migrationResult] = await Promise.all([
      database
        .prepare("SELECT version FROM application_schema_state WHERE singleton = 1")
        .first<{ version: number }>(),
      database
        .prepare("SELECT name FROM d1_migrations ORDER BY id")
        .all<{ name: string }>(),
    ]);
    const appliedMigrations = migrationResult.results.map(({ name }) => name);
    const missingMigrations = expected.migrations.filter(
      (migration) => !appliedMigrations.includes(migration),
    );
    const currentSchemaVersion = schemaState?.version ?? null;
    const versionMatches = currentSchemaVersion === expected.schemaVersion;

    return {
      appliedMigrations,
      currentSchemaVersion,
      expectedSchemaVersion: expected.schemaVersion,
      missingMigrations,
      ready: versionMatches && missingMigrations.length === 0,
      ...(!versionMatches
        ? { reason: "Application schema version does not match the Worker contract" }
        : missingMigrations.length > 0
          ? { reason: "One or more required D1 migrations are not applied" }
          : {}),
    };
  } catch {
    return {
      appliedMigrations: [],
      currentSchemaVersion: null,
      expectedSchemaVersion: expected.schemaVersion,
      missingMigrations: [...expected.migrations],
      ready: false,
      reason: "D1 schema metadata is unavailable",
    };
  }
}
