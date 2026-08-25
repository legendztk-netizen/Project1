export type CatalogReleaseStatus = "draft" | "published" | "superseded";
export type MeasurementMethodCode =
  "M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07";

export interface MeasurementEndpointClass {
  code: string;
  displayName: string;
  recordVersion: number;
  referenceKind: string;
}

export interface HoseEndEndpointAssignment {
  endpointClassCode: string;
  hoseEndSku: string;
}

export interface LengthMeasurementMethod {
  code: MeasurementMethodCode;
  diagramAssetKey: string;
  displayName: string;
  endpointRule: string;
  overlayVersion: string;
  recordVersion: number;
}

export interface LengthMeasurementMapping {
  endAClassCode: string;
  endBClassCode: string;
  guidanceStatus: "guided" | "manual_quote_only";
  id: string;
  methodCode: MeasurementMethodCode | null;
}

export interface ClockingConvention {
  acceptedMaximumDegrees: number;
  acceptedMinimumDegrees: number;
  code: "M08";
  measurementDirection: "clockwise";
  notSureOutcome: "manual_review";
  presets: number[];
  recordVersion: number;
  rendererVersion: string;
  standardToleranceDegrees: number;
  tighterToleranceOutcome: "manual_review";
  viewDirection: "end_a_toward_end_b";
  zeroReference: "end_b_at_6_oclock";
}

export interface InstalledProtection {
  availability: "available" | "temporarily_unavailable" | "discontinued";
  code: string;
  currency: "USD";
  isNoAdditionalProtection: boolean;
  publicName: string;
  recordVersion: number;
  referencePriceUsd: number | null;
  specification: string;
}

export interface InstalledProtectionRule {
  applicationCode: string | null;
  hoseSeries: string | null;
  id: string;
  requiresProtection: boolean;
}

export interface AssemblyEstimateSchedule {
  assemblyServicePriceUsd: number | null;
  currency: "USD";
  ferrulePriceSource: "catalog_sales_offer";
  hoseEndPriceSource: "catalog_sales_offer";
  hosePriceSource: "catalog_sales_offer_per_ft";
  protectionPriceSource: "installed_protection_registry";
  recordVersion: number;
}

export interface ConfiguratorReferenceSnapshot {
  assemblyEstimateSchedule: AssemblyEstimateSchedule | null;
  clockingConvention: ClockingConvention | null;
  endpointAssignments: HoseEndEndpointAssignment[];
  endpointClasses: MeasurementEndpointClass[];
  installedProtectionRules: InstalledProtectionRule[];
  installedProtections: InstalledProtection[];
  measurementMappings: LengthMeasurementMapping[];
  measurementMethods: LengthMeasurementMethod[];
  release: {
    id: string;
    releaseNumber: string;
    status: CatalogReleaseStatus;
  };
}

export interface ConfiguratorReferenceValidationFinding {
  code: string;
  message: string;
}

const requiredMeasurementMethodCodes: MeasurementMethodCode[] = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
];

export function validateConfiguratorReferenceSnapshot(
  snapshot: ConfiguratorReferenceSnapshot,
): ConfiguratorReferenceValidationFinding[] {
  const findings: ConfiguratorReferenceValidationFinding[] = [];
  const methodCodes = new Set(
    snapshot.measurementMethods.map(({ code }) => code),
  );
  for (const code of requiredMeasurementMethodCodes) {
    if (!methodCodes.has(code)) {
      findings.push({
        code: "missing_measurement_method",
        message: `Configurator registry is missing ${code}.`,
      });
    }
  }
  if (!snapshot.clockingConvention) {
    findings.push({
      code: "missing_clocking_convention",
      message: "Configurator registry is missing Clocking Convention M08.",
    });
  }
  if (!snapshot.assemblyEstimateSchedule) {
    findings.push({
      code: "missing_assembly_estimate_schedule",
      message:
        "Configurator registry is missing the Assembly Estimate Schedule.",
    });
  }

  const endpointClassCodes = new Set(
    snapshot.endpointClasses.map(({ code }) => code),
  );
  const assignedSkus = new Set<string>();
  for (const assignment of snapshot.endpointAssignments) {
    if (!endpointClassCodes.has(assignment.endpointClassCode)) {
      findings.push({
        code: "invalid_endpoint_assignment",
        message: `Hose End ${assignment.hoseEndSku} references missing endpoint class ${assignment.endpointClassCode}.`,
      });
    }
    if (assignedSkus.has(assignment.hoseEndSku)) {
      findings.push({
        code: "duplicate_endpoint_assignment",
        message: `Hose End ${assignment.hoseEndSku} has more than one endpoint assignment.`,
      });
    }
    assignedSkus.add(assignment.hoseEndSku);
  }

  const noAdditional = snapshot.installedProtections.filter(
    ({ isNoAdditionalProtection }) => isNoAdditionalProtection,
  );
  if (
    noAdditional.length !== 1 ||
    noAdditional[0]?.code !== "NONE" ||
    noAdditional[0].availability !== "available" ||
    noAdditional[0].currency !== "USD" ||
    noAdditional[0].referencePriceUsd !== 0
  ) {
    findings.push({
      code: "invalid_no_additional_protection",
      message:
        "Installed Protection must contain exactly one available NONE option with a USD 0 reference price.",
    });
  }
  return findings;
}

export type MeasurementMethodResolution =
  | { method: LengthMeasurementMethod; status: "guided" }
  | {
      reason:
        | "ambiguous_mapping"
        | "explicit_manual"
        | "missing_endpoint_assignment"
        | "missing_mapping"
        | "missing_method";
      status: "manual_quote_only";
    };

export function resolveMeasurementMethod(
  snapshot: ConfiguratorReferenceSnapshot,
  endAHoseEndSku: string,
  endBHoseEndSku: string,
): MeasurementMethodResolution {
  const endA = snapshot.endpointAssignments.filter(
    (assignment) => assignment.hoseEndSku === endAHoseEndSku,
  );
  const endB = snapshot.endpointAssignments.filter(
    (assignment) => assignment.hoseEndSku === endBHoseEndSku,
  );
  if (endA.length !== 1 || endB.length !== 1) {
    return {
      reason: "missing_endpoint_assignment",
      status: "manual_quote_only",
    };
  }

  const mappings = snapshot.measurementMappings.filter(
    (mapping) =>
      mapping.endAClassCode === endA[0].endpointClassCode &&
      mapping.endBClassCode === endB[0].endpointClassCode,
  );
  if (mappings.length === 0) {
    return { reason: "missing_mapping", status: "manual_quote_only" };
  }
  if (mappings.length !== 1) {
    return { reason: "ambiguous_mapping", status: "manual_quote_only" };
  }
  const mapping = mappings[0];
  if (mapping.guidanceStatus === "manual_quote_only") {
    return { reason: "explicit_manual", status: "manual_quote_only" };
  }
  const methods = snapshot.measurementMethods.filter(
    (method) => method.code === mapping.methodCode,
  );
  return methods.length === 1
    ? { method: methods[0], status: "guided" }
    : { reason: "missing_method", status: "manual_quote_only" };
}

export function evaluateClocking(
  convention: ClockingConvention | null,
  input: {
    status: "not_applicable" | "not_sure" | "specified";
    targetDegrees: number | null;
    toleranceDegrees: number;
  },
) {
  if (!convention) {
    return {
      error: "Clocking convention is not published",
      manualReview: true,
      valid: false,
    } as const;
  }
  if (input.status === "not_applicable") {
    return {
      manualReview: false,
      normalizedTarget: null,
      valid: true,
    } as const;
  }
  if (input.status === "not_sure") {
    return { manualReview: true, normalizedTarget: null, valid: true } as const;
  }
  if (
    !Number.isInteger(input.targetDegrees) ||
    input.targetDegrees === null ||
    input.targetDegrees < convention.acceptedMinimumDegrees ||
    input.targetDegrees > convention.acceptedMaximumDegrees ||
    !Number.isFinite(input.toleranceDegrees) ||
    input.toleranceDegrees <= 0
  ) {
    return {
      error: "Clocking requires a whole degree from 000 through 359",
      manualReview: true,
      valid: false,
    } as const;
  }
  return {
    manualReview: input.toleranceDegrees < convention.standardToleranceDegrees,
    normalizedTarget: String(input.targetDegrees).padStart(3, "0"),
    valid: true,
  } as const;
}

export function resolveInstalledProtectionOptions(
  snapshot: ConfiguratorReferenceSnapshot,
  context: { applicationCode: string | null; hoseSeries: string },
) {
  const protectionRequired = snapshot.installedProtectionRules.some(
    (rule) =>
      rule.requiresProtection &&
      (rule.hoseSeries === null || rule.hoseSeries === context.hoseSeries) &&
      (rule.applicationCode === null ||
        rule.applicationCode === context.applicationCode),
  );
  return snapshot.installedProtections.filter(
    (option) =>
      option.availability === "available" &&
      (!protectionRequired || !option.isNoAdditionalProtection),
  );
}

export function estimateAssemblyReferencePrice(input: {
  assemblyServicePriceUsd: number | null;
  componentPricesUsd: {
    ferruleA: number | null;
    ferruleB: number | null;
    hose: number | null;
    hoseEndA: number | null;
    hoseEndB: number | null;
  };
  protectionPriceUsd: number | null;
}) {
  const missingInputs: Array<
    "assembly_service" | "component_price" | "installed_protection"
  > = [];
  if (input.assemblyServicePriceUsd === null)
    missingInputs.push("assembly_service");
  const componentPrices = Object.values(input.componentPricesUsd);
  if (componentPrices.some((price) => price === null))
    missingInputs.push("component_price");
  if (input.protectionPriceUsd === null)
    missingInputs.push("installed_protection");
  if (missingInputs.length > 0) return { missingInputs, totalUsd: null };
  return {
    missingInputs,
    totalUsd:
      componentPrices.reduce<number>(
        (total, price) => total + (price ?? 0),
        0,
      ) +
      (input.assemblyServicePriceUsd ?? 0) +
      (input.protectionPriceUsd ?? 0),
  };
}
