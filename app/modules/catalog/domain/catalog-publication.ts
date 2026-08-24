export interface CatalogPublicationFinding {
  code: string;
  message: string;
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
  blockers: CatalogPublicationFinding[];
  changes: string[];
  deactivations: string[];
  draftRelease: CatalogPublicationRelease;
  warnings: CatalogPublicationFinding[];
}

export interface CatalogPublicationOperation {
  actorId: string;
  auditEventId: string;
  expectedActiveGeneration: number;
  expectedDraftVersion: number;
  previousReleaseId: string | null;
  publishedAt: string;
  releaseId: string;
  requestCorrelationId: string;
  summary: {
    additionCount: number;
    changeCount: number;
    deactivationCount: number;
    warningCount: number;
  };
}

export interface CatalogPublicationRepository {
  findPublicationPreview(
    releaseId?: string | null,
  ): Promise<CatalogPublicationPreview | null>;
  publish(operation: CatalogPublicationOperation): Promise<void>;
}

export interface PublishCatalogReleaseInput {
  actorId: string;
  expectedActiveGeneration: number;
  expectedActiveReleaseId: string | null;
  expectedDraftVersion: number;
  generateId?: () => string;
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
  const preview = await repository.findPublicationPreview(input.releaseId);
  if (!preview) {
    throw new CatalogPublicationRejected("Draft Catalog Release was not found");
  }
  if (preview.blockers.length > 0) {
    throw new CatalogPublicationRejected(
      `Publication is blocked by ${preview.blockers.length} validation finding${preview.blockers.length === 1 ? "" : "s"}`,
    );
  }
  if (
    preview.draftRelease.version !== input.expectedDraftVersion ||
    preview.activeGeneration !== input.expectedActiveGeneration ||
    preview.activeRelease?.id !== (input.expectedActiveReleaseId ?? undefined)
  ) {
    throw new CatalogPublicationRejected(
      "The publication preview is stale. Review the release again.",
    );
  }

  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const publishedAt = (input.now ?? (() => new Date()))().toISOString();
  await repository.publish({
    actorId: input.actorId,
    auditEventId: generateId(),
    expectedActiveGeneration: input.expectedActiveGeneration,
    expectedDraftVersion: input.expectedDraftVersion,
    previousReleaseId: input.expectedActiveReleaseId,
    publishedAt,
    releaseId: input.releaseId,
    requestCorrelationId: input.requestCorrelationId,
    summary: {
      additionCount: preview.additions.length,
      changeCount: preview.changes.length,
      deactivationCount: preview.deactivations.length,
      warningCount: preview.warnings.length,
    },
  });
  return { preview, publishedAt };
}
