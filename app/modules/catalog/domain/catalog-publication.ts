export interface CatalogPublicationFinding {
  code: string;
  message: string;
}

export interface CatalogPublicationDifferences {
  additions: string[];
  changes: string[];
  removals: string[];
}

export interface CatalogPublicationAssemblyState {
  derivedCombinationCount: number;
  derivedSeriesCount: number;
  generationId: string | null;
  inputFingerprint: string;
}

export interface CatalogPublicationRelease {
  createdAt: string;
  id: string;
  releaseNumber: string;
  sourceImportId: string;
  version: number;
}

export interface CatalogPublicationPreview {
  activeGeneration: number;
  activeRelease: CatalogPublicationRelease | null;
  additions: string[];
  affectedSeries: string[];
  assemblyState: CatalogPublicationAssemblyState;
  blockers: CatalogPublicationFinding[];
  changes: string[];
  deactivations: string[];
  derivedCombinations: CatalogPublicationDifferences;
  draftRelease: CatalogPublicationRelease;
  images: CatalogPublicationDifferences;
  prices: CatalogPublicationDifferences;
  products: CatalogPublicationDifferences;
  relationships: CatalogPublicationDifferences;
  warnings: CatalogPublicationFinding[];
}

export interface CatalogPublicationSummary {
  additionCount: number;
  changeCount: number;
  deactivationCount: number;
  warningCount: number;
}

export interface CatalogPublicationDiffSnapshot {
  affectedSeries: string[];
  derivedCombinations: CatalogPublicationDifferences;
  images: CatalogPublicationDifferences;
  prices: CatalogPublicationDifferences;
  products: CatalogPublicationDifferences;
  relationships: CatalogPublicationDifferences;
}

export interface CatalogPublicationReceipt {
  publishedAt: string;
  releaseId: string;
  summary: CatalogPublicationSummary;
}

export interface CatalogPublicationOperation {
  actorId: string;
  auditEventId: string;
  differences: CatalogPublicationDiffSnapshot;
  expectedActiveGeneration: number;
  expectedAssemblyState: CatalogPublicationAssemblyState;
  expectedDraftVersion: number;
  previousReleaseId: string | null;
  ipAddress: string;
  publishedAt: string;
  releaseId: string;
  requestCorrelationId: string;
  summary: CatalogPublicationSummary;
}

export interface CatalogPublicationRepository {
  findPublicationPreview(
    releaseId?: string | null,
  ): Promise<CatalogPublicationPreview | null>;
  findPublicationReceipt(
    requestCorrelationId: string,
  ): Promise<CatalogPublicationReceipt | null>;
  publish(operation: CatalogPublicationOperation): Promise<void>;
  recordRejection(input: {
    actorId: string;
    auditEventId: string;
    code: string;
    message: string;
    occurredAt: string;
    ipAddress: string;
    releaseId: string;
    requestCorrelationId: string;
  }): Promise<void>;
}

export interface PublishCatalogReleaseInput {
  actorId: string;
  expectedActiveGeneration: number;
  expectedActiveReleaseId: string | null;
  expectedAssemblyState: CatalogPublicationAssemblyState;
  expectedDraftVersion: number;
  generateId?: () => string;
  ipAddress: string;
  now?: () => Date;
  releaseId: string;
  requestCorrelationId: string;
}

export class CatalogPublicationRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogPublicationRejected";
  }
}

export async function publishCatalogRelease(
  repository: CatalogPublicationRepository,
  input: PublishCatalogReleaseInput,
) {
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const publishedAt = (input.now ?? (() => new Date()))().toISOString();
  const existing = await repository.findPublicationReceipt(
    input.requestCorrelationId,
  );
  if (existing) {
    if (existing.releaseId !== input.releaseId) {
      throw new CatalogPublicationRejected(
        "The publication request identifier was already used for another release",
      );
    }
    return { ...existing, preview: null, replayed: true };
  }

  const reject = async (code: string, message: string): Promise<never> => {
    await repository.recordRejection({
      actorId: input.actorId,
      auditEventId: `${generateId()}:rejected`,
      code,
      message,
      occurredAt: publishedAt,
      ipAddress: input.ipAddress,
      releaseId: input.releaseId,
      requestCorrelationId: input.requestCorrelationId,
    });
    throw new CatalogPublicationRejected(message);
  };

  const preview = await repository.findPublicationPreview(input.releaseId);
  if (!preview) {
    return reject("draft_not_found", "Draft Catalog Release was not found");
  }
  if (preview.blockers.length > 0) {
    return reject(
      "publication_blocked",
      `Publication is blocked by ${preview.blockers.length} validation finding${preview.blockers.length === 1 ? "" : "s"}`,
    );
  }
  if (
    preview.draftRelease.version !== input.expectedDraftVersion ||
    preview.activeGeneration !== input.expectedActiveGeneration ||
    preview.activeRelease?.id !==
      (input.expectedActiveReleaseId ?? undefined) ||
    JSON.stringify(preview.assemblyState) !==
      JSON.stringify(input.expectedAssemblyState)
  ) {
    return reject(
      "stale_preview",
      "The publication preview is stale. Review the release again.",
    );
  }

  const summary = {
    additionCount: preview.additions.length,
    changeCount: preview.changes.length,
    deactivationCount: preview.deactivations.length,
    warningCount: preview.warnings.length,
  };
  const differences: CatalogPublicationDiffSnapshot = {
    affectedSeries: preview.affectedSeries,
    derivedCombinations: preview.derivedCombinations,
    images: preview.images,
    prices: preview.prices,
    products: preview.products,
    relationships: preview.relationships,
  };
  try {
    await repository.publish({
      actorId: input.actorId,
      auditEventId: generateId(),
      differences,
      expectedActiveGeneration: input.expectedActiveGeneration,
      expectedAssemblyState: input.expectedAssemblyState,
      expectedDraftVersion: input.expectedDraftVersion,
      previousReleaseId: input.expectedActiveReleaseId,
      ipAddress: input.ipAddress,
      publishedAt,
      releaseId: input.releaseId,
      requestCorrelationId: input.requestCorrelationId,
      summary,
    });
  } catch {
    return reject(
      "atomic_publication_failed",
      "Catalog Release publication failed. The active release was not changed.",
    );
  }
  return {
    preview,
    publishedAt,
    releaseId: input.releaseId,
    replayed: false,
    summary,
  };
}
