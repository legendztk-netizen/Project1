import type {
  AssemblyEstimateSchedule,
  InstalledProtection,
} from "../../configurator-reference/domain/configurator-reference";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";

export type FluidMediumCode =
  | "petroleum_hydraulic_fluid"
  | "water_based_hydraulic_fluid"
  | "other"
  | "not_sure";
export type PressureUnit = "bar" | "psi";
export type TemperatureUnit = "C" | "F";

export interface ApplicationRequirementsSnapshot {
  fluidMedium: FluidMediumCode;
  maximumWorkingPressure: {
    canonicalBar: string;
    originalUnit: PressureUnit;
    originalValue: string;
  };
  maximumOperatingTemperature: {
    canonicalC: string;
    originalUnit: TemperatureUnit;
    originalValue: string;
  };
  minimumOperatingTemperature: {
    canonicalC: string;
    originalUnit: TemperatureUnit;
    originalValue: string;
  };
  reviewReasons: ApplicationReviewReason[];
  technicalReviewRequired: boolean;
}

export type ApplicationReviewReason =
  | "component_limits_unavailable"
  | "component_pressure_limit_exceeded"
  | "fluid_medium_uncertain"
  | "hose_pressure_limit_unavailable"
  | "hose_pressure_limit_exceeded"
  | "hose_temperature_limit_unavailable"
  | "hose_temperature_limit_exceeded";

export type ApplicationRequirementsEvaluation =
  | { error: string; valid: false }
  | { application: ApplicationRequirementsSnapshot; valid: true };

export interface AssemblyLengthReferencePricing {
  assemblyServiceUsd: number | null;
  exactLengthFeet: number;
  missingInputs: Array<"assembly_service" | "installed_protection">;
  protectionUsd: number | null;
  scheduleRecordVersion: number | null;
  startedFeet: number;
}

function parsePositive(value: string) {
  const normalized = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,8})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTemperature(value: string) {
  const normalized = value.trim();
  if (!/^-?\d{1,4}(?:\.\d{1,8})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactDecimal(value: number) {
  return Number(value.toFixed(8)).toString();
}

export function evaluateApplicationRequirements(input: {
  componentWorkingBarLimits: Array<number | null>;
  fluidMedium: FluidMediumCode;
  hoseLimits: HoseConfigurationDraft["hose"]["performance"];
  maximumOperatingTemperature: string;
  maximumWorkingPressure: string;
  minimumOperatingTemperature: string;
  pressureUnit: PressureUnit;
  temperatureUnit: TemperatureUnit;
}): ApplicationRequirementsEvaluation {
  const pressure = parsePositive(input.maximumWorkingPressure);
  const minimumTemperature = parseTemperature(
    input.minimumOperatingTemperature,
  );
  const maximumTemperature = parseTemperature(
    input.maximumOperatingTemperature,
  );
  if (pressure === null) {
    return {
      error: "Enter a positive maximum system working pressure.",
      valid: false,
    };
  }
  if (minimumTemperature === null || maximumTemperature === null) {
    return {
      error: "Enter both minimum and maximum operating temperatures.",
      valid: false,
    };
  }

  const canonicalBar =
    input.pressureUnit === "psi" ? pressure / 14.503773773 : pressure;
  const canonicalMinimumC =
    input.temperatureUnit === "F"
      ? ((minimumTemperature - 32) * 5) / 9
      : minimumTemperature;
  const canonicalMaximumC =
    input.temperatureUnit === "F"
      ? ((maximumTemperature - 32) * 5) / 9
      : maximumTemperature;
  if (canonicalMinimumC > canonicalMaximumC) {
    return {
      error: "Minimum temperature cannot exceed maximum temperature.",
      valid: false,
    };
  }

  const reasons: ApplicationReviewReason[] = [];
  if (
    input.componentWorkingBarLimits.length === 0 ||
    input.componentWorkingBarLimits.some((limit) => limit === null)
  ) {
    reasons.push("component_limits_unavailable");
  }
  if (
    input.componentWorkingBarLimits.some(
      (limit) => limit !== null && canonicalBar > limit,
    )
  ) {
    reasons.push("component_pressure_limit_exceeded");
  }
  if (input.fluidMedium === "other" || input.fluidMedium === "not_sure") {
    reasons.push("fluid_medium_uncertain");
  }
  if (input.hoseLimits.workingBar === null) {
    reasons.push("hose_pressure_limit_unavailable");
  } else if (canonicalBar > input.hoseLimits.workingBar) {
    reasons.push("hose_pressure_limit_exceeded");
  }
  if (
    input.hoseLimits.temperatureMinC === null ||
    input.hoseLimits.temperatureMaxC === null
  ) {
    reasons.push("hose_temperature_limit_unavailable");
  } else if (
    canonicalMinimumC < input.hoseLimits.temperatureMinC ||
    canonicalMaximumC > input.hoseLimits.temperatureMaxC
  ) {
    reasons.push("hose_temperature_limit_exceeded");
  }

  return {
    application: {
      fluidMedium: input.fluidMedium,
      maximumWorkingPressure: {
        canonicalBar: compactDecimal(canonicalBar),
        originalUnit: input.pressureUnit,
        originalValue: input.maximumWorkingPressure.trim(),
      },
      maximumOperatingTemperature: {
        canonicalC: compactDecimal(canonicalMaximumC),
        originalUnit: input.temperatureUnit,
        originalValue: input.maximumOperatingTemperature.trim(),
      },
      minimumOperatingTemperature: {
        canonicalC: compactDecimal(canonicalMinimumC),
        originalUnit: input.temperatureUnit,
        originalValue: input.minimumOperatingTemperature.trim(),
      },
      reviewReasons: reasons,
      technicalReviewRequired: reasons.length > 0,
    },
    valid: true,
  };
}

function roundedCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateAssemblyLengthReferencePricing(input: {
  canonicalLengthMm: string;
  protection: InstalledProtection;
  schedule: AssemblyEstimateSchedule | null;
}): AssemblyLengthReferencePricing {
  const exactLengthFeet = Number(input.canonicalLengthMm) / 304.8;
  const startedFeet = Math.ceil(exactLengthFeet);
  const missingInputs: AssemblyLengthReferencePricing["missingInputs"] = [];
  const serviceRate =
    input.schedule?.assemblyServicePricePerStartedFootUsd ?? null;
  if (serviceRate === null) missingInputs.push("assembly_service");

  const protectionRates = [
    input.protection.referenceBasePriceUsd,
    input.protection.referenceMaterialPricePerFootUsd,
    input.protection.referenceInstallationPricePerStartedFootUsd,
  ];
  const isNone = input.protection.isNoAdditionalProtection;
  if (!isNone && protectionRates.some((rate) => rate === null)) {
    missingInputs.push("installed_protection");
  }

  return {
    assemblyServiceUsd:
      serviceRate === null ? null : roundedCurrency(serviceRate * startedFeet),
    exactLengthFeet,
    missingInputs,
    protectionUsd: isNone
      ? 0
      : protectionRates.some((rate) => rate === null)
        ? null
        : roundedCurrency(
            (input.protection.referenceBasePriceUsd ?? 0) +
              (input.protection.referenceMaterialPricePerFootUsd ?? 0) *
                exactLengthFeet +
              (input.protection.referenceInstallationPricePerStartedFootUsd ??
                0) *
                startedFeet,
          ),
    scheduleRecordVersion: input.schedule?.recordVersion ?? null,
    startedFeet,
  };
}

export function attachProtectionAndApplicationToDraft(
  draft: HoseConfigurationDraft,
  input: {
    application: ApplicationRequirementsSnapshot | null;
    pricing: AssemblyLengthReferencePricing;
    protection: InstalledProtection;
  },
): HoseConfigurationDraft {
  if (!draft.finishedLength) {
    throw new Error(
      "Finished length is required before protection and application",
    );
  }
  return {
    ...draft,
    applicationRequirements: input.application ?? undefined,
    installedProtection: { ...input.protection },
    lengthReferencePricing: { ...input.pricing },
  };
}
