import { createHoseConfigurationDraft } from "../../configurator/domain/hose-configuration-draft";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../../configurator/domain/compatible-end-a";
import {
  attachFinishedLengthToDraft,
  attachMeasurementSelectionToDraft,
  evaluateFinishedAssemblyLength,
  selectMeasurementMethod,
  selectMeasurementNotSure,
} from "../../configurator/domain/finished-assembly-length";
import {
  attachClockingToDraft,
  confirmClockingForDraft,
  requiresAssemblyClocking,
  selectClockingNotSure,
  specifyClocking,
} from "../../configurator/domain/assembly-clocking";
import {
  attachProtectionAndApplicationToDraft,
  calculateAssemblyLengthReferencePricing,
  evaluateApplicationRequirements,
} from "../../configurator/domain/protection-and-application";
import {
  captureAssemblySelectionBasis,
  captureHoseSelectionBasis,
  captureMeasurementSelectionBasis,
  captureProtectionSelectionBasis,
  validateAssemblyDraft,
  type DraftSelectionProvenance,
} from "../../configurator/domain/assembly-draft-validation";
import { evaluateAssemblyReview } from "../../configurator/domain/assembly-review";
import { createD1ConfiguratorRepository } from "../../configurator/infrastructure/d1-configurator-repository";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import { createD1PublicCatalogRepository } from "../../catalog/infrastructure/d1-public-catalog-repository";
import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import { QuoteListCommandRejected } from "../domain/anonymous-quote-list";
import {
  calculateConfiguredAssemblyEstimate,
  configuredAssemblyLineIdentity,
  type ConfiguredAssemblyEstimateBasis,
  type ConfiguredAssemblySnapshot,
} from "../domain/configured-assembly-quote";

function reject(message: string): never {
  throw new QuoteListCommandRejected(message, "CONFIGURATION_INVALID");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject(
      "The saved assembly draft is invalid. Review the configuration and try again.",
    );
  }
  return value as Record<string, unknown>;
}

function stringAt(value: unknown, ...path: string[]) {
  let current: unknown = value;
  for (const key of path) current = object(current)[key];
  if (typeof current !== "string" || current.trim() === "") {
    reject(
      "The saved assembly draft is incomplete. Review the configuration and try again.",
    );
  }
  return current;
}

function integerAt(value: unknown, ...path: string[]) {
  let current: unknown = value;
  for (const key of path) current = object(current)[key];
  if (!Number.isInteger(current)) {
    reject(
      "The saved assembly draft has invalid reference data. Review the configuration and try again.",
    );
  }
  return current as number;
}

function booleanAt(value: unknown, ...path: string[]) {
  let current: unknown = value;
  for (const key of path) current = object(current)[key];
  if (typeof current !== "boolean") {
    reject(
      "The saved assembly draft has an invalid boolean value. Review the configuration and try again.",
    );
  }
  return current;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fieldName: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    reject(
      `The saved ${fieldName} is invalid. Review the configuration and try again.`,
    );
  }
  return value as T[number];
}

export function catalogSalesUnitMatches(
  salesUnit: string,
  expectedUnit: "each" | "ft",
) {
  const normalizedUnit = salesUnit.trim().toLocaleLowerCase();
  return expectedUnit === "each"
    ? normalizedUnit === "ea" || normalizedUnit === "each"
    : normalizedUnit === "ft" ||
        normalizedUnit === "foot" ||
        normalizedUnit === "feet";
}

function currentUnitPrice(
  item: PublicCatalogItem | null,
  expectedUnit: "each" | "ft",
) {
  const offer = item?.offer;
  return item?.canAddToQuote &&
    offer?.currency === "USD" &&
    catalogSalesUnitMatches(offer.salesUnit, expectedUnit)
    ? offer.referencePrice
    : null;
}

export async function prepareConfiguredAssembly(input: {
  database: D1Database;
  draft: unknown;
  quantity: number;
}) {
  const raw = object(input.draft);
  const rawHoseSku = stringAt(raw, "hose", "sku");
  const rawReleaseId = stringAt(raw, "catalogRelease", "id");
  const catalog = createD1PublicCatalogRepository(input.database);
  const hoseProduct = await catalog.findItem(rawHoseSku);
  const currentDraft = hoseProduct
    ? createHoseConfigurationDraft(hoseProduct)
    : null;
  if (!currentDraft || currentDraft.catalogRelease.id !== rawReleaseId) {
    reject(
      "The selected Hose or Catalog Release changed. Review the Hose selection and try again.",
    );
  }

  const configurator = createD1ConfiguratorRepository(input.database);
  const candidates = await configurator.findCompatibleEndA(
    currentDraft.catalogRelease.id,
    currentDraft.hose.sku,
  );
  const endAInput = {
    compatibilityId: stringAt(raw, "endA", "compatibilityId"),
    ferrule: { sku: stringAt(raw, "endA", "ferrule", "sku") },
    hoseEndSku: stringAt(raw, "endA", "hoseEnd", "sku"),
  };
  const endBInput = {
    compatibilityId: stringAt(raw, "endB", "compatibilityId"),
    ferrule: { sku: stringAt(raw, "endB", "ferrule", "sku") },
    hoseEndSku: stringAt(raw, "endB", "hoseEnd", "sku"),
  };
  const endA = candidates.find(
    (candidate) =>
      candidate.compatibilityId === endAInput.compatibilityId &&
      candidate.hoseEndSku === endAInput.hoseEndSku &&
      candidate.ferrule.sku === endAInput.ferrule.sku,
  );
  const endB = candidates.find(
    (candidate) =>
      candidate.compatibilityId === endBInput.compatibilityId &&
      candidate.hoseEndSku === endBInput.hoseEndSku &&
      candidate.ferrule.sku === endBInput.ferrule.sku,
  );
  if (!endA || !endB) {
    reject(
      "One or both Hose End combinations changed. Review End A and End B and try again.",
    );
  }
  let rebuilt = attachEndBToDraft(attachEndAToDraft(currentDraft, endA), endB);

  const references = await createD1ConfiguratorReferenceRepository(
    input.database,
  ).findActiveSnapshot();
  if (!references || references.release.id !== rebuilt.catalogRelease.id) {
    reject(
      "The current configuration reference data is unavailable. Try again later.",
    );
  }
  const rawMeasurement = object(raw.measurementSelection);
  const measurementState = enumValue(
    rawMeasurement.state,
    ["not_sure", "selected"] as const,
    "measurement selection",
  );
  if (measurementState === "not_sure") {
    rebuilt = attachMeasurementSelectionToDraft(
      rebuilt,
      selectMeasurementNotSure(),
    );
  } else {
    const code = stringAt(rawMeasurement, "method", "code");
    const version = object(rawMeasurement.method).recordVersion;
    const method = references.measurementMethods.find(
      (entry) => entry.code === code && entry.recordVersion === version,
    );
    if (!method) {
      reject(
        "The selected measurement method changed. Review Finished Length and try again.",
      );
    }
    rebuilt = attachMeasurementSelectionToDraft(
      rebuilt,
      selectMeasurementMethod(method),
    );
  }

  const rawLength = object(raw.finishedLength);
  const length = evaluateFinishedAssemblyLength({
    hasBothEnds: true,
    requestedTighterTolerance: booleanAt(
      rawLength,
      "requestedTighterTolerance",
    ),
    unit: enumValue(
      rawLength.originalUnit,
      ["in", "mm"] as const,
      "length unit",
    ),
    value:
      typeof rawLength.originalValue === "string"
        ? rawLength.originalValue
        : "",
  });
  if (!length.valid) reject(length.error);
  const rawTolerance = object(rawLength.tolerance);
  if (
    stringAt(rawTolerance, "scheduleCode") !==
      length.length.tolerance.scheduleCode ||
    stringAt(rawTolerance, "scheduleVersion") !==
      length.length.tolerance.scheduleVersion
  ) {
    reject(
      "The assembly length tolerance schedule changed. Review Finished Length and try again.",
    );
  }
  rebuilt = attachFinishedLengthToDraft(rebuilt, length.length);

  if (requiresAssemblyClocking(rebuilt)) {
    const rawClocking = object(raw.clocking);
    const currentConvention = references.clockingConvention;
    const clockingStatus = enumValue(
      rawClocking.status,
      ["not_sure", "specified"] as const,
      "Clocking selection",
    );
    if (
      integerAt(rawClocking, "convention", "recordVersion") !==
      currentConvention?.recordVersion
    ) {
      reject("The Clocking convention changed. Review Clocking and try again.");
    }
    const clocking =
      clockingStatus === "not_sure"
        ? selectClockingNotSure(currentConvention)
        : specifyClocking(
            currentConvention,
            typeof rawClocking.targetDegrees === "number"
              ? String(rawClocking.targetDegrees)
              : "",
          );
    if (!clocking.valid) reject(clocking.error);
    const confirmed = confirmClockingForDraft(rebuilt, clocking.selection);
    if (!confirmed)
      reject("Clocking could not be confirmed for the selected Hose Ends.");
    rebuilt = attachClockingToDraft(rebuilt, confirmed);
  }

  const rawProtection = object(raw.installedProtection);
  const protectionCode = stringAt(rawProtection, "code");
  const protectionVersion = rawProtection.recordVersion;
  const protection = references.installedProtections.find(
    (entry) =>
      entry.code === protectionCode &&
      entry.recordVersion === protectionVersion &&
      entry.availability === "available",
  );
  const schedule = references.assemblyEstimateSchedule;
  if (!protection || !schedule) {
    reject(
      "Protection or reference pricing changed. Review Protection and try again.",
    );
  }
  if (
    integerAt(raw, "lengthReferencePricing", "scheduleRecordVersion") !==
    schedule.recordVersion
  ) {
    reject(
      "The assembly estimate schedule changed. Review Protection and try again.",
    );
  }

  let application = null;
  if (raw.applicationRequirements) {
    const value = object(raw.applicationRequirements);
    const pressure = object(value.maximumWorkingPressure);
    const minimum = object(value.minimumOperatingTemperature);
    const maximum = object(value.maximumOperatingTemperature);
    const fluidMedium = enumValue(
      value.fluidMedium,
      [
        "petroleum_hydraulic_fluid",
        "water_based_hydraulic_fluid",
        "other",
        "not_sure",
      ] as const,
      "fluid medium",
    );
    const pressureUnit = enumValue(
      pressure.originalUnit,
      ["bar", "psi"] as const,
      "pressure unit",
    );
    const minimumTemperatureUnit = enumValue(
      minimum.originalUnit,
      ["C", "F"] as const,
      "temperature unit",
    );
    const maximumTemperatureUnit = enumValue(
      maximum.originalUnit,
      ["C", "F"] as const,
      "temperature unit",
    );
    if (minimumTemperatureUnit !== maximumTemperatureUnit) {
      reject(
        "Minimum and maximum operating temperatures must use the same unit.",
      );
    }
    const evaluated = evaluateApplicationRequirements({
      componentWorkingBarLimits: [
        endA.assemblyWorkingBar,
        endB.assemblyWorkingBar,
      ],
      fluidMedium,
      hoseLimits: rebuilt.hose.performance,
      maximumOperatingTemperature: String(maximum.originalValue ?? ""),
      maximumWorkingPressure: String(pressure.originalValue ?? ""),
      minimumOperatingTemperature: String(minimum.originalValue ?? ""),
      pressureUnit,
      temperatureUnit: minimumTemperatureUnit,
    });
    if (!evaluated.valid) reject(evaluated.error);
    application = evaluated.application;
  }
  const lengthPricing = calculateAssemblyLengthReferencePricing({
    canonicalLengthMm: rebuilt.finishedLength!.canonicalMm,
    protection,
    schedule,
  });
  rebuilt = attachProtectionAndApplicationToDraft(rebuilt, {
    application,
    pricing: lengthPricing,
    protection,
  });

  const assemblyBasis = captureAssemblySelectionBasis(rebuilt);
  if (!assemblyBasis) reject("The assembly is incomplete.");
  const provenance: DraftSelectionProvenance = {
    endA: captureHoseSelectionBasis(rebuilt),
    endB: captureHoseSelectionBasis(rebuilt),
    finishedLength: {
      ...assemblyBasis,
      measurement: captureMeasurementSelectionBasis(
        rebuilt.measurementSelection!,
      ),
    },
    protection: captureProtectionSelectionBasis(rebuilt, schedule)!,
  };
  const validation = validateAssemblyDraft(rebuilt, provenance, {
    activeCatalogRelease: {
      id: references.release.id,
      number: references.release.releaseNumber,
    },
    assemblyEstimateSchedule: schedule,
    clockingConvention: references.clockingConvention,
    compatibleCandidates: {
      candidates,
      hoseSku: rebuilt.hose.sku,
      releaseId: rebuilt.catalogRelease.id,
    },
    currentHoses: [hoseProduct!],
    installedProtectionRules: references.installedProtectionRules,
    installedProtections: references.installedProtections,
    measurementMethods: references.measurementMethods,
  });
  const review = evaluateAssemblyReview({
    draft: rebuilt,
    quantityInput: String(input.quantity),
    validation,
  });
  if (!review.canAddConfiguredLine) {
    reject(
      review.outcome === "manual_quote"
        ? "This configuration requires a manual assembly quote. Contact our team before adding it."
        : "The assembly changed or is incomplete. Review the highlighted steps and try again.",
    );
  }

  const [endAProduct, endBProduct, ferruleAProduct, ferruleBProduct] =
    await Promise.all([
      catalog.findItem(endA.hoseEndSku),
      catalog.findItem(endB.hoseEndSku),
      catalog.findItem(endA.ferrule.sku),
      catalog.findItem(endB.ferrule.sku),
    ]);
  const estimateInput = {
    assemblyServiceUsd: lengthPricing.assemblyServiceUsd,
    ferruleAPriceUsd: currentUnitPrice(ferruleAProduct, "each"),
    ferruleBPriceUsd: currentUnitPrice(ferruleBProduct, "each"),
    finishedOverallLengthFeet: lengthPricing.exactLengthFeet,
    hoseCutLengthFeet: null,
    hoseEndAPriceUsd: currentUnitPrice(endAProduct, "each"),
    hoseEndBPriceUsd: currentUnitPrice(endBProduct, "each"),
    hosePricePerFootUsd: currentUnitPrice(hoseProduct, "ft"),
    protectionUsd: lengthPricing.protectionUsd,
  };
  const estimate = calculateConfiguredAssemblyEstimate(estimateInput);
  const estimateBasis: ConfiguredAssemblyEstimateBasis = {
    ...estimateInput,
    basis: "versioned_reference_inputs",
    catalogReleaseId: rebuilt.catalogRelease.id,
    currency: "USD",
    protectionRecordVersion: protection.recordVersion,
    scheduleRecordVersion: schedule.recordVersion,
  };
  const snapshot: ConfiguredAssemblySnapshot = {
    configuration: rebuilt,
    review: { issues: validation.issues, outcome: review.outcome },
    sourceCatalogRelease: { ...rebuilt.catalogRelease },
  };
  return {
    estimateBasis,
    hoseProduct: hoseProduct!,
    lineIdentity: await configuredAssemblyLineIdentity({
      configuration: rebuilt,
      estimateBasis,
    }),
    quantity: review.quantity!,
    snapshot,
    unitEstimateAmount: estimate.unitEstimateUsd,
  };
}
