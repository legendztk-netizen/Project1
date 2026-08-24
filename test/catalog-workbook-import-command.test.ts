import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  validateCatalogWorkbook,
  type CatalogWorkbookSheet,
} from "../app/modules/catalog/domain/catalog-workbook";
import {
  importCatalogWorkbook,
  type CatalogWorkbookImportRepository,
  type CatalogWorkbookImportReview,
} from "../app/modules/catalog/domain/catalog-workbook-import";
import { readCatalogWorkbook } from "../app/modules/catalog/infrastructure/read-catalog-workbook";
import { createD1CatalogWorkbookImportRepository } from "../app/modules/catalog/infrastructure/d1-catalog-workbook-import-repository";

const workbookPath = fileURLToPath(
  new URL(
    "./fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    import.meta.url,
  ),
);

let fixture: CatalogWorkbookSheet[];

function repositoryDouble() {
  let review: CatalogWorkbookImportReview | null = null;
  let validDraftWrites = 0;
  let failedWrites = 0;
  const repository: CatalogWorkbookImportRepository = {
    async findImportReviewById(id) {
      return review?.id === id ? review : null;
    },
    async findLatestImportReview() {
      return review;
    },
    async saveFailedImport(operation) {
      failedWrites += 1;
      review = operation.review;
    },
    async saveValidatedDraft(operation) {
      validDraftWrites += 1;
      review = operation.review;
    },
  };
  return {
    counts: () => ({ failedWrites, validDraftWrites }),
    repository,
  };
}

function failingD1Double() {
  let importCreated = false;
  let cleanupRan = false;
  const database = {
    async batch() {
      throw new Error("The final batch should not run after an insert failure");
    },
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement;
        },
        async run() {
          if (sql.includes("INSERT INTO catalog_imports")) importCreated = true;
          if (sql.includes('INSERT INTO "catalog_hose_ends"')) {
            throw new Error("injected hose-end insert failure");
          }
          if (sql.includes("DELETE FROM catalog_imports")) cleanupRan = true;
          return { success: true };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return {
    database,
    state: () => ({ cleanupRan, importCreated }),
  };
}

beforeAll(async () => {
  const file = await readFile(workbookPath);
  fixture = await readCatalogWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
});

describe("importCatalogWorkbook", () => {
  it("persists one reviewable draft only after the full workbook validates", async () => {
    const { counts, repository } = repositoryDouble();
    const ids = ["import-1", "release-1", "audit-1"];

    const review = await importCatalogWorkbook(repository, {
      actorId: "local-owner",
      fileName: "catalog.xlsx",
      fileSizeBytes: 543_210,
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => new Date("2026-08-24T03:00:00.000Z"),
      sheets: fixture,
    });

    expect(counts()).toEqual({ failedWrites: 0, validDraftWrites: 1 });
    expect(review).toMatchObject({
      draftReleaseId: "release-1",
      errorCount: 0,
      id: "import-1",
      status: "completed",
      summary: {
        compatibilityCount: 1081,
        ferruleCount: 61,
        hoseEndCount: 200,
        hoseSeriesCount: 6,
        hoseVariantCount: 61,
        skuCount: 322,
      },
    });
  });

  it("persists validation results but creates no draft for a blocking error", async () => {
    const { counts, repository } = repositoryDouble();
    const invalid = structuredClone(fixture);
    const compatibility = invalid.find(
      (sheet) => sheet.sheet === "04_兼容压接",
    );
    if (!compatibility) throw new Error("Missing compatibility fixture");
    compatibility.data[4][2] = "UNKNOWN_HOSE";
    const ids = ["failed-import", "audit-1"];

    const review = await importCatalogWorkbook(repository, {
      actorId: "local-owner",
      fileName: "invalid.xlsx",
      fileSizeBytes: 500,
      generateId: () => ids.shift() ?? "unexpected-id",
      now: () => new Date("2026-08-24T03:00:00.000Z"),
      sheets: invalid,
    });

    expect(counts()).toEqual({ failedWrites: 1, validDraftWrites: 0 });
    expect(review).toMatchObject({
      draftReleaseId: null,
      errorCount: 1,
      status: "failed",
      summary: {
        compatibilityCount: 0,
        skuCount: 0,
      },
    });
    expect(review.validationResults[0]).toMatchObject({
      code: "broken_foreign_key",
      row: 5,
      sku: "UNKNOWN_HOSE",
    });
  });

  it("cleans up the pending import when normalized row persistence fails", async () => {
    const validation = validateCatalogWorkbook(fixture);
    if (!validation.draft)
      throw new Error("Expected the real fixture to validate");
    const { database, state } = failingD1Double();
    const repository = createD1CatalogWorkbookImportRepository(database);

    await expect(
      repository.saveValidatedDraft({
        actorId: "local-owner",
        auditEventId: "audit-rollback",
        draft: validation.draft,
        review: {
          completedAt: "2026-08-24T03:00:00.000Z",
          createdAt: "2026-08-24T03:00:00.000Z",
          draftReleaseId: "release-rollback",
          draftReleaseNumber: "DRAFT-ROLLBACK",
          errorCount: 0,
          id: "import-rollback",
          sourceFileName: "catalog.xlsx",
          sourceFileSizeBytes: 543_210,
          status: "completed",
          summary: {
            compatibilityCount: 1081,
            ferruleCount: 61,
            hoseEndCount: 200,
            hoseSeriesCount: 6,
            hoseVariantCount: 61,
            skuCount: 322,
          },
          validationResults: [],
          warningCount: 0,
        },
      }),
    ).rejects.toThrow("injected hose-end insert failure");
    expect(state()).toEqual({ cleanupRan: true, importCreated: true });
  });
});
