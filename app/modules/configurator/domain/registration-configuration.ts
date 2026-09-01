import type { DraftSelectionProvenance } from "./assembly-draft-validation";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";

export const registrationConfigurationLifetimeSeconds = 24 * 60 * 60;
export const registrationConfigurationMaximumBytes = 256 * 1024;

export type RegistrationConfigurationStage =
  "hose" | "end-a" | "end-b" | "length" | "clocking" | "protection" | "review";

export interface RegistrationConfigurationSnapshot {
  catalogContext: {
    releaseId: string | null;
    releaseNumber: string | null;
  };
  configuration: HoseConfigurationDraft | null;
  quantityInput: string;
  referenceContext: {
    assemblyEstimateScheduleVersion: number | null;
    clockingConventionVersion: number | null;
    installedProtectionVersion: number | null;
    measurementDiagramAssetVersion: string | null;
    measurementMethodVersion: number | null;
    measurementOverlayVersion: string | null;
  };
  selectedFamilyKey: string | null;
  selectedSku: string | null;
  selectionProvenance: DraftSelectionProvenance;
  stage: RegistrationConfigurationStage;
  version: 1;
}

export class RegistrationConfigurationRejected extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return value === null || (typeof value === "string" && value.length > 0);
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.length > 0;
}

function optionalNumber(value: unknown) {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0;
}

function optionalPositiveInteger(value: unknown) {
  return value === null || positiveInteger(value);
}

function optionalNonNegativeNumber(value: unknown) {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function decimalString(value: unknown, positive = false) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && (!positive || parsed > 0);
}

function uniqueEnumArray(value: unknown, allowed: string[]) {
  if (!Array.isArray(value) || !value.every(requiredString)) return false;
  return (
    value.every((item: string) => allowed.includes(item)) &&
    new Set(value).size === value.length
  );
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every(requiredString);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validReferenceContext(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "assemblyEstimateScheduleVersion",
      "clockingConventionVersion",
      "installedProtectionVersion",
      "measurementDiagramAssetVersion",
      "measurementMethodVersion",
      "measurementOverlayVersion",
    ]) &&
    optionalPositiveInteger(value.assemblyEstimateScheduleVersion) &&
    optionalPositiveInteger(value.clockingConventionVersion) &&
    optionalPositiveInteger(value.installedProtectionVersion) &&
    optionalString(value.measurementDiagramAssetVersion) &&
    optionalPositiveInteger(value.measurementMethodVersion) &&
    optionalString(value.measurementOverlayVersion)
  );
}

function validFerrule(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "hoseConstruction",
      "hoseTailDash",
      "series",
      "skiveRequirement",
      "sku",
    ]) &&
    requiredString(value.hoseConstruction) &&
    optionalString(value.hoseTailDash) &&
    requiredString(value.series) &&
    requiredString(value.skiveRequirement) &&
    requiredString(value.sku)
  );
}

function validHoseEnd(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "aliases",
      "angle",
      "connectionDash",
      "connectionStandard",
      "displayName",
      "gender",
      "hoseTailDash",
      "interfaceFamily",
      "interfaceGroup",
      "maximumWorkingBar",
      "mediaKey",
      "sealingForm",
      "sku",
      "swivelForm",
      "thread",
    ]) &&
    stringArray(value.aliases) &&
    requiredString(value.angle) &&
    optionalString(value.connectionDash) &&
    requiredString(value.connectionStandard) &&
    requiredString(value.displayName) &&
    requiredString(value.gender) &&
    optionalString(value.hoseTailDash) &&
    requiredString(value.interfaceFamily) &&
    requiredString(value.interfaceGroup) &&
    optionalNumber(value.maximumWorkingBar) &&
    requiredString(value.mediaKey) &&
    requiredString(value.sealingForm) &&
    requiredString(value.sku) &&
    requiredString(value.swivelForm) &&
    requiredString(value.thread)
  );
}

function validConfiguredEnd(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "assemblyWorkingBar",
      "compatibilityId",
      "ferrule",
      "hoseEnd",
    ]) &&
    optionalNumber(value.assemblyWorkingBar) &&
    requiredString(value.compatibilityId) &&
    validFerrule(value.ferrule) &&
    validHoseEnd(value.hoseEnd)
  );
}

function validMeasurementSelection(value: unknown) {
  if (!isRecord(value)) return false;
  if (value.state === "not_sure") {
    return (
      hasOnlyKeys(value, [
        "diagram",
        "manualTechnicalReviewRequired",
        "method",
        "state",
      ]) &&
      value.diagram === null &&
      value.method === null &&
      value.manualTechnicalReviewRequired === true
    );
  }
  if (
    value.state !== "selected" ||
    !hasOnlyKeys(value, ["diagram", "method", "state"]) ||
    !isRecord(value.diagram) ||
    !hasOnlyKeys(value.diagram, [
      "assetKey",
      "assetVersion",
      "overlayVersion",
    ]) ||
    !requiredString(value.diagram.assetKey) ||
    !requiredString(value.diagram.assetVersion) ||
    !requiredString(value.diagram.overlayVersion) ||
    !isRecord(value.method) ||
    !hasOnlyKeys(value.method, [
      "code",
      "diagramAssetKey",
      "diagramAssetVersion",
      "displayName",
      "endpointRule",
      "overlayVersion",
      "recordVersion",
    ])
  ) {
    return false;
  }
  return (
    /^M0[1-7]$/u.test(String(value.method.code)) &&
    requiredString(value.method.diagramAssetKey) &&
    requiredString(value.method.diagramAssetVersion) &&
    requiredString(value.method.displayName) &&
    requiredString(value.method.endpointRule) &&
    requiredString(value.method.overlayVersion) &&
    positiveInteger(value.method.recordVersion)
  );
}

function validFinishedLength(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "canonicalMm",
      "lengthFeasibilityReviewRequired",
      "manualReviewReasons",
      "originalUnit",
      "originalValue",
      "path",
      "requestedTighterTolerance",
      "tolerance",
    ]) ||
    !decimalString(value.canonicalMm, true) ||
    value.lengthFeasibilityReviewRequired !== true ||
    !uniqueEnumArray(value.manualReviewReasons, [
      "both_ends_required",
      "finer_than_1_8_in",
      "finer_than_1_mm",
      "over_50_ft",
      "tighter_tolerance_requested",
    ]) ||
    !["in", "mm"].includes(String(value.originalUnit)) ||
    !requiredString(value.originalValue) ||
    !["guided", "manual_review"].includes(String(value.path)) ||
    value.path !==
      ((value.manualReviewReasons as unknown[]).length === 0
        ? "guided"
        : "manual_review") ||
    typeof value.requestedTighterTolerance !== "boolean" ||
    !isRecord(value.tolerance) ||
    !hasOnlyKeys(value.tolerance, [
      "band",
      "display",
      "percent",
      "plusMinusCanonicalMm",
      "scheduleCode",
      "scheduleVersion",
    ])
  ) {
    return false;
  }
  return (
    [
      "up_to_12_in",
      "over_12_through_18_in",
      "over_18_through_36_in",
      "over_36_in",
    ].includes(String(value.tolerance.band)) &&
    requiredString(value.tolerance.display) &&
    (value.tolerance.percent === null || value.tolerance.percent === 1) &&
    decimalString(value.tolerance.plusMinusCanonicalMm, true) &&
    value.tolerance.scheduleCode === "SAE_J517_ASSEMBLY_LENGTH" &&
    value.tolerance.scheduleVersion === "1.0.0"
  );
}

function validClocking(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "configuredEnds",
      "convention",
      "manualTechnicalReviewRequired",
      "standardToleranceDegrees",
      "status",
      "targetDegrees",
      "targetDisplay",
      "validation",
    ]) ||
    !isRecord(value.configuredEnds) ||
    !hasOnlyKeys(value.configuredEnds, ["endA", "endB"]) ||
    !isRecord(value.configuredEnds.endA) ||
    !isRecord(value.configuredEnds.endB) ||
    !hasOnlyKeys(value.configuredEnds.endA, ["angle", "sku"]) ||
    !hasOnlyKeys(value.configuredEnds.endB, ["angle", "sku"]) ||
    !requiredString(value.configuredEnds.endA.angle) ||
    !requiredString(value.configuredEnds.endA.sku) ||
    !requiredString(value.configuredEnds.endB.angle) ||
    !requiredString(value.configuredEnds.endB.sku) ||
    !isRecord(value.convention) ||
    !hasOnlyKeys(value.convention, [
      "code",
      "measurementDirection",
      "recordVersion",
      "rendererVersion",
      "viewDirection",
      "zeroReference",
    ])
  ) {
    return false;
  }
  const specified = value.status === "specified";
  return (
    value.convention.code === "M08" &&
    value.convention.measurementDirection === "clockwise" &&
    positiveInteger(value.convention.recordVersion) &&
    requiredString(value.convention.rendererVersion) &&
    value.convention.viewDirection === "end_a_toward_end_b" &&
    value.convention.zeroReference === "end_b_at_6_oclock" &&
    typeof value.manualTechnicalReviewRequired === "boolean" &&
    value.standardToleranceDegrees === 3 &&
    ["specified", "not_sure"].includes(String(value.status)) &&
    (specified
      ? Number.isInteger(value.targetDegrees) &&
        Number(value.targetDegrees) >= 0 &&
        Number(value.targetDegrees) <= 359
      : value.targetDegrees === null) &&
    (specified
      ? value.targetDisplay === String(value.targetDegrees).padStart(3, "0")
      : value.targetDisplay === null) &&
    value.manualTechnicalReviewRequired === !specified &&
    ["confirmed", "retained_invalid"].includes(String(value.validation))
  );
}

function validApplicationRequirements(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "fluidMedium",
      "maximumOperatingTemperature",
      "maximumWorkingPressure",
      "minimumOperatingTemperature",
      "reviewReasons",
      "technicalReviewRequired",
    ]) ||
    ![
      "petroleum_hydraulic_fluid",
      "water_based_hydraulic_fluid",
      "other",
      "not_sure",
    ].includes(String(value.fluidMedium)) ||
    !uniqueEnumArray(value.reviewReasons, [
      "component_limits_unavailable",
      "component_pressure_limit_exceeded",
      "fluid_medium_uncertain",
      "hose_pressure_limit_unavailable",
      "hose_pressure_limit_exceeded",
      "hose_temperature_limit_unavailable",
      "hose_temperature_limit_exceeded",
    ]) ||
    typeof value.technicalReviewRequired !== "boolean" ||
    value.technicalReviewRequired !==
      (value.reviewReasons as unknown[]).length > 0
  ) {
    return false;
  }
  for (const key of [
    "maximumOperatingTemperature",
    "minimumOperatingTemperature",
  ]) {
    const temperature = value[key];
    if (
      !isRecord(temperature) ||
      !hasOnlyKeys(temperature, [
        "canonicalC",
        "originalUnit",
        "originalValue",
      ]) ||
      !decimalString(temperature.canonicalC) ||
      !["C", "F"].includes(String(temperature.originalUnit)) ||
      !requiredString(temperature.originalValue)
    ) {
      return false;
    }
  }
  const pressure = value.maximumWorkingPressure;
  return (
    isRecord(pressure) &&
    hasOnlyKeys(pressure, ["canonicalBar", "originalUnit", "originalValue"]) &&
    decimalString(pressure.canonicalBar, true) &&
    ["bar", "psi"].includes(String(pressure.originalUnit)) &&
    requiredString(pressure.originalValue)
  );
}

function validInstalledProtection(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "availability",
      "code",
      "currency",
      "isNoAdditionalProtection",
      "publicName",
      "recordVersion",
      "referenceBasePriceUsd",
      "referenceInstallationPricePerStartedFootUsd",
      "referenceMaterialPricePerFootUsd",
      "referencePriceUsd",
      "specification",
    ]) &&
    ["available", "temporarily_unavailable", "discontinued"].includes(
      String(value.availability),
    ) &&
    requiredString(value.code) &&
    value.currency === "USD" &&
    typeof value.isNoAdditionalProtection === "boolean" &&
    requiredString(value.publicName) &&
    positiveInteger(value.recordVersion) &&
    optionalNonNegativeNumber(value.referenceBasePriceUsd) &&
    optionalNonNegativeNumber(
      value.referenceInstallationPricePerStartedFootUsd,
    ) &&
    optionalNonNegativeNumber(value.referenceMaterialPricePerFootUsd) &&
    optionalNonNegativeNumber(value.referencePriceUsd) &&
    typeof value.specification === "string"
  );
}

function validLengthReferencePricing(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "assemblyServiceUsd",
      "exactLengthFeet",
      "missingInputs",
      "protectionUsd",
      "scheduleRecordVersion",
      "startedFeet",
    ]) &&
    optionalNonNegativeNumber(value.assemblyServiceUsd) &&
    typeof value.exactLengthFeet === "number" &&
    Number.isFinite(value.exactLengthFeet) &&
    value.exactLengthFeet > 0 &&
    Array.isArray(value.missingInputs) &&
    value.missingInputs.every((item) =>
      ["assembly_service", "installed_protection"].includes(String(item)),
    ) &&
    optionalNonNegativeNumber(value.protectionUsd) &&
    optionalPositiveInteger(value.scheduleRecordVersion) &&
    positiveInteger(value.startedFeet)
  );
}

function validConfiguration(value: unknown) {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "applicationRequirements",
      "catalogRelease",
      "clocking",
      "endA",
      "endB",
      "finishedLength",
      "hose",
      "installedProtection",
      "lengthReferencePricing",
      "measurementSelection",
    ]) ||
    !isRecord(value.catalogRelease) ||
    !hasOnlyKeys(value.catalogRelease, ["id", "number"]) ||
    !requiredString(value.catalogRelease.id) ||
    !requiredString(value.catalogRelease.number) ||
    !isRecord(value.hose) ||
    !hasOnlyKeys(value.hose, [
      "dash",
      "equivalentStandard",
      "familyKey",
      "familyName",
      "mediaKey",
      "nominalIdIn",
      "performance",
      "primaryStandard",
      "reinforcement",
      "series",
      "sku",
    ]) ||
    !optionalString(value.hose.dash) ||
    !optionalString(value.hose.equivalentStandard) ||
    !requiredString(value.hose.familyKey) ||
    !requiredString(value.hose.familyName) ||
    !optionalString(value.hose.mediaKey) ||
    !optionalNumber(value.hose.nominalIdIn) ||
    !optionalString(value.hose.primaryStandard) ||
    !optionalString(value.hose.reinforcement) ||
    !requiredString(value.hose.series) ||
    !requiredString(value.hose.sku) ||
    !isRecord(value.hose.performance) ||
    !hasOnlyKeys(value.hose.performance, [
      "temperatureMaxC",
      "temperatureMinC",
      "workingBar",
      "workingPsi",
    ]) ||
    !optionalNumber(value.hose.performance.temperatureMaxC) ||
    !optionalNumber(value.hose.performance.temperatureMinC) ||
    !optionalNumber(value.hose.performance.workingBar) ||
    !optionalNumber(value.hose.performance.workingPsi)
  ) {
    return false;
  }
  for (const key of ["endA", "endB"] as const) {
    const end = value[key];
    if (end === undefined) continue;
    if (!validConfiguredEnd(end)) return false;
  }
  if (
    (value.endB !== undefined && value.endA === undefined) ||
    (value.measurementSelection !== undefined &&
      (value.endA === undefined || value.endB === undefined)) ||
    (value.finishedLength !== undefined &&
      value.measurementSelection === undefined) ||
    (value.clocking !== undefined &&
      (value.measurementSelection === undefined ||
        value.finishedLength === undefined)) ||
    (value.installedProtection === undefined) !==
      (value.lengthReferencePricing === undefined) ||
    ((value.clocking !== undefined ||
      value.applicationRequirements !== undefined ||
      value.installedProtection !== undefined ||
      value.lengthReferencePricing !== undefined) &&
      (value.endA === undefined || value.endB === undefined)) ||
    ((value.applicationRequirements !== undefined ||
      value.installedProtection !== undefined ||
      value.lengthReferencePricing !== undefined) &&
      value.finishedLength === undefined)
  ) {
    return false;
  }
  return (
    (value.applicationRequirements === undefined ||
      validApplicationRequirements(value.applicationRequirements)) &&
    (value.clocking === undefined || validClocking(value.clocking)) &&
    (value.finishedLength === undefined ||
      validFinishedLength(value.finishedLength)) &&
    (value.installedProtection === undefined ||
      validInstalledProtection(value.installedProtection)) &&
    (value.lengthReferencePricing === undefined ||
      validLengthReferencePricing(value.lengthReferencePricing)) &&
    (value.measurementSelection === undefined ||
      validMeasurementSelection(value.measurementSelection))
  );
}

function validSelectionBasis(value: unknown, assembly: boolean) {
  if (!isRecord(value)) return false;
  const keys = ["catalogReleaseId", "hoseSku"];
  if (assembly) {
    keys.push(
      "endACompatibilityId",
      "endAHoseEndSku",
      "endBCompatibilityId",
      "endBHoseEndSku",
    );
  }
  return (
    hasOnlyKeys(value, keys) && keys.every((key) => requiredString(value[key]))
  );
}

function validSelectionProvenance(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["endA", "endB", "finishedLength", "protection"])
  ) {
    return false;
  }
  if (value.endA !== undefined && !validSelectionBasis(value.endA, false)) {
    return false;
  }
  if (value.endB !== undefined && !validSelectionBasis(value.endB, false)) {
    return false;
  }
  if (value.finishedLength !== undefined) {
    const entry = value.finishedLength;
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, [
        "catalogReleaseId",
        "endACompatibilityId",
        "endAHoseEndSku",
        "endBCompatibilityId",
        "endBHoseEndSku",
        "hoseSku",
        "measurement",
      ]) ||
      !isRecord(entry.measurement) ||
      !["not_sure", "selected"].includes(String(entry.measurement.state)) ||
      (entry.measurement.state === "not_sure"
        ? !hasOnlyKeys(entry.measurement, ["state"])
        : !hasOnlyKeys(entry.measurement, [
            "code",
            "diagramAssetVersion",
            "overlayVersion",
            "recordVersion",
            "state",
          ]) ||
          !requiredString(entry.measurement.code) ||
          !requiredString(entry.measurement.diagramAssetVersion) ||
          !requiredString(entry.measurement.overlayVersion) ||
          !positiveInteger(entry.measurement.recordVersion))
    ) {
      return false;
    }
    const { measurement: _measurement, ...basis } = entry;
    if (!validSelectionBasis(basis, true)) return false;
  }
  if (value.protection !== undefined) {
    const entry = value.protection;
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, [
        "applicationCode",
        "catalogReleaseId",
        "endACompatibilityId",
        "endAHoseEndSku",
        "endBCompatibilityId",
        "endBHoseEndSku",
        "finishedLengthCanonicalMm",
        "hoseSku",
        "protectionCode",
        "protectionRecordVersion",
        "scheduleRecordVersion",
      ]) ||
      !optionalString(entry.applicationCode) ||
      !requiredString(entry.finishedLengthCanonicalMm) ||
      !requiredString(entry.protectionCode) ||
      !positiveInteger(entry.protectionRecordVersion) ||
      !optionalPositiveInteger(entry.scheduleRecordVersion)
    ) {
      return false;
    }
    const {
      applicationCode: _applicationCode,
      finishedLengthCanonicalMm: _finishedLengthCanonicalMm,
      protectionCode: _protectionCode,
      protectionRecordVersion: _protectionRecordVersion,
      scheduleRecordVersion: _scheduleRecordVersion,
      ...basis
    } = entry;
    if (!validSelectionBasis(basis, true)) return false;
  }
  return true;
}

export function parseRegistrationConfigurationSnapshot(serialized: string) {
  if (
    !serialized ||
    new TextEncoder().encode(serialized).byteLength >
      registrationConfigurationMaximumBytes
  ) {
    throw new RegistrationConfigurationRejected(
      "The unfinished configuration is too large to save.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new RegistrationConfigurationRejected(
      "The unfinished configuration could not be read.",
    );
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    ![
      "hose",
      "end-a",
      "end-b",
      "length",
      "clocking",
      "protection",
      "review",
    ].includes(String(value.stage)) ||
    !optionalString(value.selectedFamilyKey) ||
    !optionalString(value.selectedSku) ||
    typeof value.quantityInput !== "string" ||
    value.quantityInput.length > 32 ||
    !hasOnlyKeys(value, [
      "catalogContext",
      "configuration",
      "quantityInput",
      "referenceContext",
      "selectedFamilyKey",
      "selectedSku",
      "selectionProvenance",
      "stage",
      "version",
    ]) ||
    !isRecord(value.catalogContext) ||
    !hasOnlyKeys(value.catalogContext, ["releaseId", "releaseNumber"]) ||
    !optionalString(value.catalogContext.releaseId) ||
    !optionalString(value.catalogContext.releaseNumber) ||
    !validReferenceContext(value.referenceContext) ||
    !validSelectionProvenance(value.selectionProvenance) ||
    !validConfiguration(value.configuration) ||
    (!value.selectedFamilyKey && !value.configuration)
  ) {
    throw new RegistrationConfigurationRejected(
      "The unfinished configuration is incomplete or invalid.",
    );
  }
  if (
    value.configuration &&
    (value.catalogContext.releaseId !==
      (value.configuration as { catalogRelease: { id: string } }).catalogRelease
        .id ||
      value.catalogContext.releaseNumber !==
        (value.configuration as { catalogRelease: { number: string } })
          .catalogRelease.number)
  ) {
    throw new RegistrationConfigurationRejected(
      "The selected Hose or Catalog Release does not match the unfinished configuration.",
    );
  }
  return value as unknown as RegistrationConfigurationSnapshot;
}

export function serializedRegistrationConfigurationSnapshot(
  snapshot: RegistrationConfigurationSnapshot,
) {
  const serialized = JSON.stringify(snapshot);
  parseRegistrationConfigurationSnapshot(serialized);
  return serialized;
}
