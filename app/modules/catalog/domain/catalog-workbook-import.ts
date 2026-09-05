import {
  type CatalogImportValidationResult,
  type CatalogWorkbookSheet,
  type ValidatedCatalogDraft,
  validateCatalogWorkbook,
} from "./catalog-workbook";
import { mediaVersionIdFromReference } from "./catalog-product-image";

export interface CatalogImportSummary {
  adapterCount: number;
  adapterFamilyCount: number;
  compatibilityCount: number;
  costBasisPriceCount: number;
  ferruleCount: number;
  hoseEndCount: number;
  hoseSeriesCount: number;
  hoseVariantCount: number;
  quickCouplerCount: number;
  referencePriceCount: number;
  salesOfferCount: number;
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
  findMissingMediaVersionIds(ids: string[]): Promise<string[]>;
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
    adapterCount: 0,
    adapterFamilyCount: 0,
    compatibilityCount: 0,
    costBasisPriceCount: 0,
    ferruleCount: 0,
    hoseEndCount: 0,
    hoseSeriesCount: 0,
    hoseVariantCount: 0,
    quickCouplerCount: 0,
    referencePriceCount: 0,
    salesOfferCount: 0,
    skuCount: 0,
  };
}

function draftSummary(draft: ValidatedCatalogDraft): CatalogImportSummary {
  return {
    adapterCount: draft.adapters.length,
    adapterFamilyCount: draft.adapterFamilies.length,
    compatibilityCount: draft.compatibilities.length,
    costBasisPriceCount: draft.costBases.filter(
      (row) => row.factoryUnitPrice !== null || row.tierPrice !== null,
    ).length,
    ferruleCount: draft.ferrules.length,
    hoseEndCount: draft.hoseEnds.length,
    hoseSeriesCount: draft.hoseSeriesRecords.length,
    hoseVariantCount: draft.hoseVariants.length,
    quickCouplerCount: draft.quickCouplers.length,
    referencePriceCount: draft.salesOffers.filter(
      (row) => row.referencePriceUsd !== null,
    ).length,
    salesOfferCount: draft.salesOffers.length,
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
  const validationResults = [...validation.validationResults];
  if (validation.draft) {
    const seriesReferences = [
      ...validation.draft.hoseSeriesRecords.map((series) => ({
        field: "Hose Series Main Image Reference / 胶管系列主图引用",
        reference: series.mainImageReference,
        seriesCode: series.seriesCode,
        worksheet: "01_胶管主数据",
      })),
      ...validation.draft.hoseEndSeries.map((series) => ({
        field: "Fitting Series Main Image Reference / 接头系列主图引用",
        reference: series.mainImageReference,
        seriesCode: series.seriesCode,
        worksheet: "02_压接接头",
      })),
    ];
    const uploadedMediaIds = [
      ...new Set(
        seriesReferences
          .map(({ reference }) => mediaVersionIdFromReference(reference))
          .filter((id): id is string => id !== null),
      ),
    ];
    const missingIds = new Set(
      await repository.findMissingMediaVersionIds(uploadedMediaIds),
    );
    for (const series of seriesReferences) {
      const mediaVersionId = mediaVersionIdFromReference(series.reference);
      if (!mediaVersionId || !missingIds.has(mediaVersionId)) continue;
      validationResults.push({
        code: "missing_media_version",
        field: series.field,
        message: `Uploaded reviewed image version "${mediaVersionId}" was not found for series "${series.seriesCode}"`,
        row: 0,
        severity: "error",
        sku: series.seriesCode,
        worksheet: series.worksheet,
      });
    }
  }
  const blockingErrors = validationResults.filter(
    (result) => result.severity === "error",
  );
  const baseReview = {
    completedAt: timestamp,
    createdAt: timestamp,
    errorCount: blockingErrors.length,
    id: importId,
    sourceFileName: input.fileName,
    sourceFileSizeBytes: input.fileSizeBytes,
    validationResults,
    warningCount: validationResults.filter(
      (result) => result.severity === "warning",
    ).length,
  };

  if (!validation.draft || blockingErrors.length > 0) {
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
