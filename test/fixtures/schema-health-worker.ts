import { createHealthResponse } from "../../workers/health";
import { createD1ConfiguratorReferenceRepository } from "../../app/modules/configurator-reference/infrastructure/d1-configurator-reference-repository";

interface FixtureBindings extends CloudflareBindings {
  TEST_EXPECTED_MIGRATIONS: string;
  TEST_EXPECTED_SCHEMA_VERSION: string;
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/configurator-reference/active") {
      const url = new URL(request.url);
      const repository = createD1ConfiguratorReferenceRepository(env.DB);
      const releaseId = url.searchParams.get("release");
      const snapshot = releaseId
        ? await repository.findSnapshot(releaseId)
        : await repository.findActiveSnapshot();
      return Response.json({ snapshot });
    }
    return createHealthResponse(env, {
      migrations: JSON.parse(env.TEST_EXPECTED_MIGRATIONS) as string[],
      schemaVersion: Number(env.TEST_EXPECTED_SCHEMA_VERSION),
    });
  },
} satisfies ExportedHandler<FixtureBindings>;
