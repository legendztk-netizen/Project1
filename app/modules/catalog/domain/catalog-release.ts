export interface DiagnosticCatalogRelease {
  createdAt: string;
  id: string;
  publishedAt: null;
  releaseNumber: string;
  releaseVersion: number;
  sourceImportId: string;
  status: "draft";
}

export interface CreateDiagnosticDraftOperation {
  actorId: string;
  auditEventId: string;
  release: DiagnosticCatalogRelease;
}

export interface CatalogReleaseRepository {
  createDiagnosticDraft(operation: CreateDiagnosticDraftOperation): Promise<void>;
  findDiagnosticDraftById(id: string): Promise<DiagnosticCatalogRelease | null>;
  findLatestDiagnosticDraft(): Promise<DiagnosticCatalogRelease | null>;
}

interface CreateDiagnosticCatalogReleaseDependencies {
  actorId: string;
  generateId?: () => string;
  now?: () => Date;
}

function diagnosticReleaseNumber(now: Date, id: string) {
  const timestamp = now.toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
  return `DIAG-${timestamp}-${id.replaceAll("-", "").slice(-8).toUpperCase()}`;
}

export async function createDiagnosticCatalogRelease(
  repository: CatalogReleaseRepository,
  dependencies: CreateDiagnosticCatalogReleaseDependencies,
) {
  const generateId = dependencies.generateId ?? (() => crypto.randomUUID());
  const now = dependencies.now?.() ?? new Date();
  const releaseId = generateId();
  const release: DiagnosticCatalogRelease = {
    createdAt: now.toISOString(),
    id: releaseId,
    publishedAt: null,
    releaseNumber: diagnosticReleaseNumber(now, releaseId),
    releaseVersion: 1,
    sourceImportId: generateId(),
    status: "draft",
  };

  await repository.createDiagnosticDraft({
    actorId: dependencies.actorId,
    auditEventId: generateId(),
    release,
  });
  const persisted = await repository.findDiagnosticDraftById(releaseId);
  if (!persisted) throw new Error("Diagnostic Catalog Release was not persisted");
  return persisted;
}
