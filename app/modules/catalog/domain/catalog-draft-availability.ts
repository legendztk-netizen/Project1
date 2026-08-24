export const supplyAvailabilityValues = [
  "available_for_quote",
  "temporarily_unavailable",
  "discontinued",
] as const;

export type SupplyAvailability = (typeof supplyAvailabilityValues)[number];

export type DraftProductSelector =
  | { mode: "worksheet"; sourceWorksheet: string }
  | { hoseSeries: string; mode: "hose_series" }
  | { mode: "selected"; skus: readonly string[] };

export interface DraftAvailabilityCandidate {
  sku: string;
  supplyAvailability: SupplyAvailability;
}

export interface DraftCatalogProductReview {
  catalogPublicationStatus: string;
  costBasisCurrency: string | null;
  factoryUnitPrice: number | null;
  hoseSeries: string | null;
  priceIncoterm: string | null;
  productType: string;
  referencePriceUsd: number | null;
  rfqEligibility: string;
  sku: string;
  sourceWorksheet: string;
  supplyAvailability: SupplyAvailability;
  technicalDataStatus: string;
}

export interface DraftCatalogReviewFilters {
  hoseSeries: string | null;
  sku: string | null;
  sourceWorksheet: string | null;
}

export interface DraftCatalogReview {
  filters: DraftCatalogReviewFilters;
  hoseSeriesOptions: string[];
  products: DraftCatalogProductReview[];
  release: {
    createdAt: string;
    id: string;
    releaseNumber: string;
    sourceImportId: string;
  };
  totalCount: number;
  worksheetOptions: string[];
}

export interface DraftAvailabilityChangePreview {
  affectedCount: number;
  affectedSkus: string[];
  matchedCount: number;
  releaseId: string;
  selector: DraftProductSelector;
  target: SupplyAvailability;
}

export interface ApplyDraftAvailabilityChangeOperation extends DraftAvailabilityChangePreview {
  actorId: string;
  auditEventId: string;
  occurredAt: string;
}

export interface DraftAvailabilityRepository {
  applyAvailabilityChange(
    operation: ApplyDraftAvailabilityChangeOperation,
  ): Promise<void>;
  findAvailabilityCandidates(
    releaseId: string,
    selector: DraftProductSelector,
  ): Promise<DraftAvailabilityCandidate[]>;
}

export interface DraftAvailabilityChangeInput {
  actorId: string;
  generateId?: () => string;
  now?: () => Date;
  releaseId: string;
  selector: DraftProductSelector;
  target: SupplyAvailability;
}

function normalizeSelector(
  selector: DraftProductSelector,
): DraftProductSelector {
  if (selector.mode === "selected") {
    return {
      mode: "selected",
      skus: [
        ...new Set(selector.skus.map((sku) => sku.trim()).filter(Boolean)),
      ],
    };
  }
  if (selector.mode === "worksheet") {
    return {
      mode: "worksheet",
      sourceWorksheet: selector.sourceWorksheet.trim(),
    };
  }
  return { hoseSeries: selector.hoseSeries.trim(), mode: "hose_series" };
}

function assertChangeInput(
  releaseId: string,
  selector: DraftProductSelector,
  target: SupplyAvailability,
) {
  if (!releaseId.trim()) throw new Error("Draft release is required");
  if (!supplyAvailabilityValues.includes(target)) {
    throw new Error("Supply Availability target is invalid");
  }
  if (
    (selector.mode === "worksheet" && !selector.sourceWorksheet) ||
    (selector.mode === "hose_series" && !selector.hoseSeries)
  ) {
    throw new Error("Bulk selection value is required");
  }
}

export async function previewDraftSupplyAvailabilityChange(
  repository: DraftAvailabilityRepository,
  input: Omit<DraftAvailabilityChangeInput, "actorId" | "generateId" | "now">,
): Promise<DraftAvailabilityChangePreview> {
  const selector = normalizeSelector(input.selector);
  assertChangeInput(input.releaseId, selector, input.target);
  const candidates = await repository.findAvailabilityCandidates(
    input.releaseId,
    selector,
  );
  const affectedSkus = candidates
    .filter((candidate) => candidate.supplyAvailability !== input.target)
    .map((candidate) => candidate.sku);

  return {
    affectedCount: affectedSkus.length,
    affectedSkus,
    matchedCount: candidates.length,
    releaseId: input.releaseId,
    selector,
    target: input.target,
  };
}

export async function applyDraftSupplyAvailabilityChange(
  repository: DraftAvailabilityRepository,
  input: DraftAvailabilityChangeInput,
) {
  const preview = await previewDraftSupplyAvailabilityChange(repository, input);
  if (preview.affectedCount === 0)
    return { ...preview, applied: false as const };

  await repository.applyAvailabilityChange({
    ...preview,
    actorId: input.actorId,
    auditEventId: (input.generateId ?? (() => crypto.randomUUID()))(),
    occurredAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  return { ...preview, applied: true as const };
}
