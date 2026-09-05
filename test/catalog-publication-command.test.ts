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
    affectedSeries: ["601R1"],
    assemblyState: {
      derivedCombinationCount: 4,
      derivedSeriesCount: 1,
      generationId: "assembly-generation-1",
      inputFingerprint: "assembly-input-1",
    },
    blockers: [],
    changes: ["CHANGED_001"],
    deactivations: ["OLD_001"],
    derivedCombinations: {
      additions: ["601R1_001 / COMP-A → COMP-B"],
      changes: [],
      removals: [],
    },
    draftRelease: {
      createdAt: "2026-08-24T00:00:00.000Z",
      id: "release-new",
      releaseNumber: "CAT-NEW",
      sourceImportId: "import-new",
      version: 7,
    },
    images: { additions: [], changes: ["CHANGED_001"], removals: [] },
    prices: { additions: [], changes: ["CHANGED_001"], removals: [] },
    products: {
      additions: ["NEW_001"],
      changes: ["CHANGED_001"],
      removals: ["OLD_001"],
    },
    relationships: { additions: [], changes: [], removals: [] },
    warnings: [{ code: "optional", message: "Optional value is missing" }],
    ...overrides,
  };
}

function repositoryDouble(preview: CatalogPublicationPreview | null) {
  const operations: CatalogPublicationOperation[] = [];
  const rejections: string[] = [];
  const repository: CatalogPublicationRepository = {
    async findPublicationReceipt() {
      return null;
    },
    async findPublicationPreview() {
      return preview;
    },
    async publish(operation) {
      operations.push(operation);
    },
    async recordRejection(input) {
      rejections.push(input.code);
    },
  };
  return { operations, rejections, repository };
}

function input() {
  return {
    actorId: "owner-1",
    expectedActiveGeneration: 4,
    expectedActiveReleaseId: "release-old",
    expectedAssemblyState: fixturePreview().assemblyState,
    expectedDraftVersion: 7,
    generateId: () => "audit-1",
    ipAddress: "203.0.113.10",
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
        differences: {
          affectedSeries: ["601R1"],
          derivedCombinations: {
            additions: ["601R1_001 / COMP-A → COMP-B"],
            changes: [],
            removals: [],
          },
          images: { additions: [], changes: ["CHANGED_001"], removals: [] },
          prices: { additions: [], changes: ["CHANGED_001"], removals: [] },
          products: {
            additions: ["NEW_001"],
            changes: ["CHANGED_001"],
            removals: ["OLD_001"],
          },
          relationships: { additions: [], changes: [], removals: [] },
        },
        expectedActiveGeneration: 4,
        expectedAssemblyState: fixturePreview().assemblyState,
        expectedDraftVersion: 7,
        previousReleaseId: "release-old",
        ipAddress: "203.0.113.10",
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
    const { operations, rejections, repository } = repositoryDouble(
      fixturePreview({
        blockers: [{ code: "count_mismatch", message: "SKU count changed" }],
      }),
    );

    await expect(publishCatalogRelease(repository, input())).rejects.toThrow(
      CatalogPublicationRejected,
    );
    expect(operations).toHaveLength(0);
    expect(rejections).toEqual(["publication_blocked"]);
  });

  it.each([
    { expectedDraftVersion: 6 },
    { expectedActiveGeneration: 3 },
    { expectedActiveReleaseId: "another-release" },
    {
      expectedAssemblyState: {
        ...fixturePreview().assemblyState,
        generationId: "newer-generation",
      },
    },
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

  it("returns the original receipt for an idempotent retry", async () => {
    const { repository } = repositoryDouble(null);
    repository.findPublicationReceipt = async () => ({
      publishedAt: "2026-08-24T06:00:00.000Z",
      releaseId: "release-new",
      summary: {
        additionCount: 1,
        changeCount: 2,
        deactivationCount: 0,
        warningCount: 0,
      },
    });
    await expect(
      publishCatalogRelease(repository, input()),
    ).resolves.toMatchObject({ releaseId: "release-new", replayed: true });
  });
});
