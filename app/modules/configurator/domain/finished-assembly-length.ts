import type { LengthMeasurementMethod } from "../../configurator-reference/domain/configurator-reference";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";

export type FinishedLengthUnit = "in" | "mm";

export type MeasurementSelectionSnapshot =
  | {
      diagram: {
        assetKey: string;
        assetVersion: string;
        overlayVersion: string;
      };
      method: LengthMeasurementMethod;
      state: "selected";
    }
  | {
      diagram: null;
      manualTechnicalReviewRequired: true;
      method: null;
      state: "not_sure";
    };

export type FinishedLengthManualReviewReason =
  | "both_ends_required"
  | "finer_than_1_8_in"
  | "finer_than_1_mm"
  | "over_50_ft"
  | "tighter_tolerance_requested";

export interface AssemblyLengthToleranceSnapshot {
  band:
    | "up_to_12_in"
    | "over_12_through_18_in"
    | "over_18_through_36_in"
    | "over_36_in";
  display: string;
  percent: 1 | null;
  plusMinusCanonicalMm: string;
  scheduleCode: "SAE_J517_ASSEMBLY_LENGTH";
  scheduleVersion: "1.0.0";
}

export interface FinishedAssemblyLengthSnapshot {
  canonicalMm: string;
  lengthFeasibilityReviewRequired: true;
  manualReviewReasons: FinishedLengthManualReviewReason[];
  originalUnit: FinishedLengthUnit;
  originalValue: string;
  path: "guided" | "manual_review";
  requestedTighterTolerance: boolean;
  tolerance: AssemblyLengthToleranceSnapshot;
}

export type FinishedAssemblyLengthEvaluation =
  | {
      error: "Enter a positive finished overall assembly length.";
      valid: false;
    }
  | {
      length: FinishedAssemblyLengthSnapshot;
      valid: true;
    };

interface Rational {
  denominator: bigint;
  numerator: bigint;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function rational(numerator: bigint, denominator: bigint): Rational {
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    denominator: denominator / divisor,
    numerator: numerator / divisor,
  };
}

function parseDecimal(value: string): Rational | null {
  const normalized = value.trim();
  if (!/^\d{1,9}(?:\.\d{1,18})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  return numerator > 0n ? rational(numerator, denominator) : null;
}

function multiply(value: Rational, numerator: bigint, denominator = 1n) {
  return rational(value.numerator * numerator, value.denominator * denominator);
}

function lessThanOrEqual(left: Rational, right: Rational) {
  return (
    left.numerator * right.denominator <= right.numerator * left.denominator
  );
}

function decimalString(value: Rational) {
  let denominator = value.denominator;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos += 1;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives += 1;
  }
  if (denominator !== 1n) {
    throw new Error(
      "Finished length cannot be represented as an exact decimal",
    );
  }
  const decimalPlaces = Math.max(twos, fives);
  const scaledNumerator =
    value.numerator *
    2n ** BigInt(decimalPlaces - twos) *
    5n ** BigInt(decimalPlaces - fives);
  if (decimalPlaces === 0) return scaledNumerator.toString();
  const padded = scaledNumerator.toString().padStart(decimalPlaces + 1, "0");
  const whole = padded.slice(0, -decimalPlaces);
  const fraction = padded.slice(-decimalPlaces).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function toleranceFor(canonicalMm: Rational): AssemblyLengthToleranceSnapshot {
  const base = {
    scheduleCode: "SAE_J517_ASSEMBLY_LENGTH" as const,
    scheduleVersion: "1.0.0" as const,
  };
  if (lessThanOrEqual(canonicalMm, rational(3048n, 10n))) {
    return {
      ...base,
      band: "up_to_12_in",
      display: "± 1/8 in (± 3.175 mm)",
      percent: null,
      plusMinusCanonicalMm: "3.175",
    };
  }
  if (lessThanOrEqual(canonicalMm, rational(4572n, 10n))) {
    return {
      ...base,
      band: "over_12_through_18_in",
      display: "± 3/16 in (± 4.7625 mm)",
      percent: null,
      plusMinusCanonicalMm: "4.7625",
    };
  }
  if (lessThanOrEqual(canonicalMm, rational(9144n, 10n))) {
    return {
      ...base,
      band: "over_18_through_36_in",
      display: "± 1/4 in (± 6.35 mm)",
      percent: null,
      plusMinusCanonicalMm: "6.35",
    };
  }
  return {
    ...base,
    band: "over_36_in",
    display: `± 1% (± ${decimalString(multiply(canonicalMm, 1n, 100n))} mm)`,
    percent: 1,
    plusMinusCanonicalMm: decimalString(multiply(canonicalMm, 1n, 100n)),
  };
}

export function selectMeasurementMethod(
  method: LengthMeasurementMethod,
): MeasurementSelectionSnapshot {
  return {
    diagram: {
      assetKey: method.diagramAssetKey,
      assetVersion: method.diagramAssetVersion,
      overlayVersion: method.overlayVersion,
    },
    method: { ...method },
    state: "selected",
  };
}

export function selectMeasurementNotSure(): MeasurementSelectionSnapshot {
  return {
    diagram: null,
    manualTechnicalReviewRequired: true,
    method: null,
    state: "not_sure",
  };
}

export function evaluateFinishedAssemblyLength(input: {
  hasBothEnds: boolean;
  requestedTighterTolerance: boolean;
  unit: FinishedLengthUnit;
  value: string;
}): FinishedAssemblyLengthEvaluation {
  const original = input.value.trim();
  const parsed = parseDecimal(original);
  if (!parsed) {
    return {
      error: "Enter a positive finished overall assembly length.",
      valid: false,
    };
  }

  const canonicalMm =
    input.unit === "in" ? multiply(parsed, 254n, 10n) : parsed;
  const manualReviewReasons: FinishedLengthManualReviewReason[] = [];
  if (!input.hasBothEnds) manualReviewReasons.push("both_ends_required");
  if (
    input.unit === "in" &&
    (parsed.numerator * 8n) % parsed.denominator !== 0n
  ) {
    manualReviewReasons.push("finer_than_1_8_in");
  }
  if (input.unit === "mm" && parsed.numerator % parsed.denominator !== 0n) {
    manualReviewReasons.push("finer_than_1_mm");
  }
  if (!lessThanOrEqual(canonicalMm, rational(15240n, 1n))) {
    manualReviewReasons.push("over_50_ft");
  }
  if (input.requestedTighterTolerance) {
    manualReviewReasons.push("tighter_tolerance_requested");
  }

  return {
    length: {
      canonicalMm: decimalString(canonicalMm),
      lengthFeasibilityReviewRequired: true,
      manualReviewReasons,
      originalUnit: input.unit,
      originalValue: original,
      path: manualReviewReasons.length === 0 ? "guided" : "manual_review",
      requestedTighterTolerance: input.requestedTighterTolerance,
      tolerance: toleranceFor(canonicalMm),
    },
    valid: true,
  };
}

export function attachMeasurementSelectionToDraft(
  draft: HoseConfigurationDraft,
  measurementSelection: MeasurementSelectionSnapshot,
): HoseConfigurationDraft {
  return {
    ...draft,
    finishedLength: undefined,
    measurementSelection,
  };
}

export function attachFinishedLengthToDraft(
  draft: HoseConfigurationDraft,
  finishedLength: FinishedAssemblyLengthSnapshot,
): HoseConfigurationDraft {
  if (!draft.endA || !draft.endB || !draft.measurementSelection) {
    throw new Error(
      "Both hose ends and an explicit measurement selection are required",
    );
  }
  return { ...draft, finishedLength };
}
