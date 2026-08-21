import { describe, expect, it } from "vitest";

import {
  createDiagnosticCatalogRelease,
  type CatalogReleaseRepository,
  type DiagnosticCatalogRelease,
} from "../app/modules/catalog/domain/catalog-release";

describe("createDiagnosticCatalogRelease", () => {
  it("creates only a non-published diagnostic release through the repository", async () => {
    let persisted: DiagnosticCatalogRelease | null = null;
    let persistedActorId: string | null = null;
    const repository: CatalogReleaseRepository = {
      async createDiagnosticDraft(operation) {
        persisted = operation.release;
        persistedActorId = operation.actorId;
      },
      async findDiagnosticDraftById(id) {
        return persisted?.id === id ? persisted : null;
      },
      async findLatestDiagnosticDraft() {
        return persisted;
      },
    };

    const release = await createDiagnosticCatalogRelease(repository, {
      actorId: "local-owner",
      generateId: () => "018f0000-0000-7000-8000-000000000001",
      now: () => new Date("2026-08-21T08:00:00.000Z"),
    });

    expect(release).toMatchObject({
      publishedAt: null,
      status: "draft",
    });
    expect(persistedActorId).toBe("local-owner");
    expect(release.releaseNumber).toMatch(/^DIAG-/);
  });
});
