import {
  inspectDatabaseSchemaReadiness,
  type DatabaseSchemaContract,
} from "./schema-readiness";

type HealthBindings = Pick<CloudflareBindings, "APP_ENV" | "DB">;

export async function createHealthResponse(
  env: HealthBindings,
  expectedSchema?: DatabaseSchemaContract,
) {
  const database = await inspectDatabaseSchemaReadiness(env.DB, expectedSchema);
  const ready = database.ready;

  return Response.json(
    {
      application: "hydraulic-hose-rfq-platform",
      database,
      environment: env.APP_ENV,
      status: ready ? "ok" : "blocked",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: ready ? 200 : 503,
    },
  );
}
