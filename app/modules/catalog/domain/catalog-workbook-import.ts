import {
  type CatalogImportValidationResult,
  type CatalogWorkbookSheet,
  type ValidatedCatalogDraft,
  validateCatalogWorkbook,
} from "./catalog-workbook";

export interface CatalogImportSummary {
  compatibilityCount: number;
  ferruleCount: number;
  hoseEndCount: number;
  hoseSeriesCount: number;
  hoseVariantCount: number;
  skuCount: number;
}

export interface CatalogWorkbookImportReview {
  completedAt: string;
  createdAt: string;
  draftReleaseId: string | null;
  draftReleaseNumber: string | null;
  errorCount: number;
  id: string;
  sourceFileName: string;
  sourceFileSizeBytes: number;
  status: "completed" | "failed";
  summary: CatalogImportSummary;
  validationResults: CatalogImportValidationResult[];
  warningCount: number;
}

export interface SaveFailedCatalogImportOperation {
  actorId: string;
  auditEventId: string;
  review: CatalogWorkbookImportReview;
}

export interface SaveValidatedCatalogDraftOperation {
  actorId: string;
  auditEventId: string;
  draft: ValidatedCatalogDraft;
  review: CatalogWorkbookImportReview;
}

export interface CatalogWorkbookImportRepository {
  findImportReviewById(id: string): Promise<CatalogWorkbookImportReview | null>;
  findLatestImportReview(): Promise<CatalogWorkbookImportReview | null>;
  saveFailedImport(operation: SaveFailedCatalogImportOperation): Promise<void>;
  saveValidatedDraft(
    operation: SaveValidatedCatalogDraftOperation,
  ): Promise<void>;
}

interface ImportCatalogWorkbookInput {
  actorId: string;
  fileName: string;
  fileSizeBytes: number;
  generateId?: () => string;
  now?: () => Date;
  sheets: CatalogWorkbookSheet[];
}

function releaseNumber(now: Date, id: string) {
  const timestamp = now.toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
  return `DRAFT-${timestamp}-${id.replaceAll("-", "").slice(-8).toUpperCase()}`;
}

function emptySummary(): CatalogImportSummary {
  return {
    compatibilityCount: 0,
    ferruleCount: 0,
    hoseEndCount: 0,
    hoseSeriesCount: 0,
    hoseVariantCount: 0,
    skuCount: 0,
  };
}

function draftSummary(draft: ValidatedCatalogDraft): CatalogImportSummary {
  return {
    compatibilityCount: draft.compatibilities.length,
    ferruleCount: draft.ferrules.length,
    hoseEndCount: draft.hoseEnds.length,
    hoseSeriesCount: draft.hoseSeries.length,
    hoseVariantCount: draft.hoseVariants.length,
    skuCount: draft.skus.length,
  };
}

export async function importCatalogWorkbook(
  repository: CatalogWorkbookImportRepository,
  input: ImportCatalogWorkbookInput,
) {
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const now = input.now?.() ?? new Date();
  const timestamp = now.toISOString();
  const importId = generateId();
  const validation = validateCatalogWorkbook(input.sheets);
  const baseReview = {
    completedAt: timestamp,
    createdAt: timestamp,
    errorCount: validation.blockingErrors.length,
    id: importId,
    sourceFileName: input.fileName,
    sourceFileSizeBytes: input.fileSizeBytes,
    validationResults: validation.validationResults,
    warningCount: validation.validationResults.filter(
      (result) => result.severity === "warning",
    ).length,
  };

  if (!validation.draft) {
    const review: CatalogWorkbookImportReview = {
      ...baseReview,
      draftReleaseId: null,
      draftReleaseNumber: null,
      status: "failed",
      summary: emptySummary(),
    };
    await repository.saveFailedImport({
      actorId: input.actorId,
      auditEventId: generateId(),
      review,
    });
    return (await repository.findImportReviewById(importId)) ?? review;
  }

  const releaseId = generateId();
  const review: CatalogWorkbookImportReview = {
    ...baseReview,
    draftReleaseId: releaseId,
    draftReleaseNumber: releaseNumber(now, releaseId),
    status: "completed",
    summary: draftSummary(validation.draft),
  };
  await repository.saveValidatedDraft({
    actorId: input.actorId,
    auditEventId: generateId(),
    draft: validation.draft,
    review,
  });
  const persisted = await repository.findImportReviewById(importId);
  if (!persisted)
    throw new Error("Catalog workbook import review was not persisted");
  return persisted;
}
