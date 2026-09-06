import { compareCatalogText } from "./catalog-sorting";

export interface DerivedAssemblyEndpoint {
  compatibilityId: string;
  ferruleSku: string;
  hoseEndSku: string;
  hoseSeries: string;
  hoseSku: string;
  relationshipFingerprint: string;
}

export interface DerivedAssemblyCombination {
  combinationFingerprint: string;
  endACompatibilityId: string;
  endAFerruleSku: string;
  endAHoseEndSku: string;
  endARelationshipFingerprint: string;
  endBCompatibilityId: string;
  endBFerruleSku: string;
  endBHoseEndSku: string;
  endBRelationshipFingerprint: string;
  hoseSeries: string;
  hoseSku: string;
  identityKey: string;
}

export interface AssemblyRegenerationPlan {
  affectedSeries: string[];
  allDraftSeries: string[];
  baselineReleaseId: string | null;
  beforeAffectedCombinations: DerivedAssemblyCombination[];
  endpoints: DerivedAssemblyEndpoint[];
  inputFingerprint: string;
  releaseId: string;
  sourceImportId: string;
  status: "current" | "stale";
}

export interface AssemblyRegenerationSummary {
  additionCount: number;
  affectedSeries: string[];
  changeCount: number;
  combinationCount: number;
  removalCount: number;
  status: "already_current" | "succeeded";
}

export interface AssemblyRegenerationOperation extends AssemblyRegenerationSummary {
  actorId: string;
  beforeAffectedCombinations: DerivedAssemblyCombination[];
  generatedCombinations: DerivedAssemblyCombination[];
  generatedSeries: string[];
  generationId: string;
  inputFingerprint: string;
  ipAddress: string;
  occurredAt: string;
  releaseId: string;
  requestCorrelationId: string;
  sourceImportId: string;
}

export interface AssemblyRegenerationRepository {
  findPlan(releaseId: string): Promise<AssemblyRegenerationPlan | null>;
  recordAlreadyCurrent(input: {
    actorId: string;
    attemptId: string;
    inputFingerprint: string;
    ipAddress: string;
    occurredAt: string;
    releaseId: string;
    requestCorrelationId: string;
  }): Promise<void>;
  recordFailure(input: {
    actorId: string;
    affectedSeries: string[];
    attemptId: string;
    error: string;
    inputFingerprint: string;
    ipAddress: string;
    occurredAt: string;
    releaseId: string;
    requestCorrelationId: string;
  }): Promise<void>;
  regenerate(operation: AssemblyRegenerationOperation): Promise<void>;
}

export class AssemblyRegenerationRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyRegenerationRejected";
  }
}

function combinationIdentity(input: {
  endACompatibilityId: string;
  endBCompatibilityId: string;
  hoseSku: string;
}) {
  return JSON.stringify([
    input.hoseSku,
    input.endACompatibilityId,
    input.endBCompatibilityId,
  ]);
}

export function deriveAssemblyCombinations(
  endpoints: readonly DerivedAssemblyEndpoint[],
): DerivedAssemblyCombination[] {
  const byHose = new Map<string, DerivedAssemblyEndpoint[]>();
  for (const endpoint of endpoints) {
    const current = byHose.get(endpoint.hoseSku) ?? [];
    current.push(endpoint);
    byHose.set(endpoint.hoseSku, current);
  }

  const combinations: DerivedAssemblyCombination[] = [];
  for (const hoseSku of [...byHose.keys()].sort(compareCatalogText)) {
    const candidates = [...(byHose.get(hoseSku) ?? [])].sort((left, right) =>
      compareCatalogText(left.compatibilityId, right.compatibilityId),
    );
    for (const endA of candidates) {
      for (const endB of candidates) {
        const identityKey = combinationIdentity({
          endACompatibilityId: endA.compatibilityId,
          endBCompatibilityId: endB.compatibilityId,
          hoseSku,
        });
        combinations.push({
          combinationFingerprint: JSON.stringify([
            identityKey,
            endA.relationshipFingerprint,
            endB.relationshipFingerprint,
          ]),
          endACompatibilityId: endA.compatibilityId,
          endAFerruleSku: endA.ferruleSku,
          endAHoseEndSku: endA.hoseEndSku,
          endARelationshipFingerprint: endA.relationshipFingerprint,
          endBCompatibilityId: endB.compatibilityId,
          endBFerruleSku: endB.ferruleSku,
          endBHoseEndSku: endB.hoseEndSku,
          endBRelationshipFingerprint: endB.relationshipFingerprint,
          hoseSeries: endA.hoseSeries,
          hoseSku,
          identityKey,
        });
      }
    }
  }
  return combinations;
}

export function diffDerivedAssemblyCombinations(
  before: readonly DerivedAssemblyCombination[],
  after: readonly DerivedAssemblyCombination[],
) {
  const previous = new Map(
    before.map((combination) => [
      combination.identityKey,
      combination.combinationFingerprint,
    ]),
  );
  const next = new Map(
    after.map((combination) => [
      combination.identityKey,
      combination.combinationFingerprint,
    ]),
  );
  return {
    additionCount: [...next.keys()].filter((key) => !previous.has(key)).length,
    changeCount: [...next.keys()].filter(
      (key) => previous.has(key) && previous.get(key) !== next.get(key),
    ).length,
    removalCount: [...previous.keys()].filter((key) => !next.has(key)).length,
  };
}

export async function regenerateDerivedAssemblyData(
  repository: AssemblyRegenerationRepository,
  input: {
    actorId: string;
    generateId?: () => string;
    ipAddress: string;
    now?: () => Date;
    releaseId: string;
    requestCorrelationId: string;
  },
): Promise<AssemblyRegenerationSummary> {
  const plan = await repository.findPlan(input.releaseId);
  if (!plan) {
    throw new AssemblyRegenerationRejected(
      "Draft Catalog Release or assembly impact analysis was not found",
    );
  }
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const occurredAt = (input.now ?? (() => new Date()))().toISOString();
  if (plan.status === "current" || plan.affectedSeries.length === 0) {
    await repository.recordAlreadyCurrent({
      actorId: input.actorId,
      attemptId: generateId(),
      inputFingerprint: plan.inputFingerprint,
      ipAddress: input.ipAddress,
      occurredAt,
      releaseId: input.releaseId,
      requestCorrelationId: input.requestCorrelationId,
    });
    return {
      additionCount: 0,
      affectedSeries: [],
      changeCount: 0,
      combinationCount: 0,
      removalCount: 0,
      status: "already_current",
    };
  }

  const affected = new Set(plan.affectedSeries);
  const generatedCombinations = deriveAssemblyCombinations(
    plan.endpoints.filter((endpoint) => affected.has(endpoint.hoseSeries)),
  );
  const generatedSeries = plan.allDraftSeries.filter((series) =>
    affected.has(series),
  );
  const differences = diffDerivedAssemblyCombinations(
    plan.beforeAffectedCombinations,
    generatedCombinations,
  );
  const generationId = generateId();
  const summary: AssemblyRegenerationSummary = {
    ...differences,
    affectedSeries: plan.affectedSeries,
    combinationCount: generatedCombinations.length,
    status: "succeeded",
  };

  try {
    await repository.regenerate({
      ...summary,
      actorId: input.actorId,
      beforeAffectedCombinations: plan.beforeAffectedCombinations,
      generatedCombinations,
      generatedSeries,
      generationId,
      inputFingerprint: plan.inputFingerprint,
      ipAddress: input.ipAddress,
      occurredAt,
      releaseId: input.releaseId,
      requestCorrelationId: input.requestCorrelationId,
      sourceImportId: plan.sourceImportId,
    });
    return summary;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Assembly regeneration failed";
    await repository.recordFailure({
      actorId: input.actorId,
      affectedSeries: plan.affectedSeries,
      attemptId: generationId,
      error: message,
      inputFingerprint: plan.inputFingerprint,
      ipAddress: input.ipAddress,
      occurredAt,
      releaseId: input.releaseId,
      requestCorrelationId: input.requestCorrelationId,
    });
    throw new AssemblyRegenerationRejected(message);
  }
}
