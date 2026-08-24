import { describe, expect, it } from "vitest";

import {
  CatalogPublicationRejected,
  publishCatalogRelease,
  type CatalogPublicationOperation,
  type CatalogPublicationPreview,
  type CatalogPublicationRepository,
} from "../app/modules/catalog/domain/catalog-publication";

function fixturePreview(
  overrides: Partial<CatalogPublicationPreview> = {},
): CatalogPublicationPreview {
  return {
    activeGeneration: 4,
    activeRelease: {
      createdAt: "2026-08-23T00:00:00.000Z",
      id: "release-old",
      releaseNumber: "CAT-OLD",
      sourceImportId: "import-old",
      version: 2,
    },
    additions: ["NEW_001"],
    blockers: [],
    changes: ["CHANGED_001"],
    deactivations: ["OLD_001"],
    draftRelease: {
      createdAt: "2026-08-24T00:00:00.000Z",
      id: "release-new",
      releaseNumber: "CAT-NEW",
      sourceImportId: "import-new",
      version: 7,
    },
    warnings: [{ code: "optional", message: "Optional value is missing" }],
    ...overrides,
  };
}

function repositoryDouble(preview: CatalogPublicationPreview | null) {
  const operations: CatalogPublicationOperation[] = [];
  const repository: CatalogPublicationRepository = {
    async findPublicationPreview() {
      return preview;
    },
    async publish(operation) {
      operations.push(operation);
    },
  };
  return { operations, repository };
}

function input() {
  return {
    actorId: "owner-1",
    expectedActiveGeneration: 4,
    expectedActiveReleaseId: "release-old",
    expectedDraftVersion: 7,
    generateId: () => "audit-1",
    now: () => new Date("2026-08-24T06:00:00.000Z"),
    releaseId: "release-new",
    requestCorrelationId: "request-1",
  };
}

describe("Catalog Release publication command", () => {
  it("publishes a revalidated preview with an audit-safe summary", async () => {
    const { operations, repository } = repositoryDouble(fixturePreview());

    await publishCatalogRelease(repository, input());

    expect(operations).toEqual([
      {
        actorId: "owner-1",
        auditEventId: "audit-1",
        expectedActiveGeneration: 4,
        expectedDraftVersion: 7,
        previousReleaseId: "release-old",
        publishedAt: "2026-08-24T06:00:00.000Z",
        releaseId: "release-new",
        requestCorrelationId: "request-1",
        summary: {
          additionCount: 1,
          changeCount: 1,
          deactivationCount: 1,
          warningCount: 1,
        },
      },
    ]);
  });

  it("rejects blockers before any write", async () => {
    const { operations, repository } = repositoryDouble(
      fixturePreview({
        blockers: [{ code: "count_mismatch", message: "SKU count changed" }],
      }),
    );

    await expect(publishCatalogRelease(repository, input())).rejects.toThrow(
      CatalogPublicationRejected,
    );
    expect(operations).toHaveLength(0);
  });

  it.each([
    { expectedDraftVersion: 6 },
    { expectedActiveGeneration: 3 },
    { expectedActiveReleaseId: "another-release" },
  ])("rejects stale confirmation state %o", async (override) => {
    const { operations, repository } = repositoryDouble(fixturePreview());

    await expect(
      publishCatalogRelease(repository, { ...input(), ...override }),
    ).rejects.toThrow("preview is stale");
    expect(operations).toHaveLength(0);
  });

  it("supports the first publication with no prior active release", async () => {
    const { operations, repository } = repositoryDouble(
      fixturePreview({ activeGeneration: 0, activeRelease: null }),
    );

    await publishCatalogRelease(repository, {
      ...input(),
      expectedActiveGeneration: 0,
      expectedActiveReleaseId: null,
    });

    expect(operations[0]?.previousReleaseId).toBeNull();
  });
});
