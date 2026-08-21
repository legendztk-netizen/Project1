import { createHealthResponse } from "../../workers/health";

interface FixtureBindings extends CloudflareBindings {
  TEST_EXPECTED_MIGRATIONS: string;
  TEST_EXPECTED_SCHEMA_VERSION: string;
}

export default {
  fetch(_request, env) {
    return createHealthResponse(env, {
      migrations: JSON.parse(env.TEST_EXPECTED_MIGRATIONS) as string[],
      schemaVersion: Number(env.TEST_EXPECTED_SCHEMA_VERSION),
    });
  },
} satisfies ExportedHandler<FixtureBindings>;
