import type { ClockingConvention } from "../../configurator-reference/domain/configurator-reference";
import { evaluateClocking } from "../../configurator-reference/domain/configurator-reference";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";

export interface ClockingConventionSnapshot {
  code: "M08";
  measurementDirection: "clockwise";
  recordVersion: number;
  rendererVersion: string;
  viewDirection: "end_a_toward_end_b";
  zeroReference: "end_b_at_6_oclock";
}

export const standardClockingToleranceDegrees = 3;

export type HoseEndAngleClassification = "angled" | "straight" | "unknown";

export type AssemblyClockingApplicability =
  | { status: "not_applicable" }
  | { status: "required" }
  | { reason: "unknown_end_angle"; status: "manual_review" };

export type ClockingSelectionSnapshot =
  | {
      convention: ClockingConventionSnapshot;
      manualTechnicalReviewRequired: false;
      standardToleranceDegrees: number;
      status: "specified";
      targetDegrees: number;
      targetDisplay: string;
    }
  | {
      convention: ClockingConventionSnapshot;
      manualTechnicalReviewRequired: true;
      standardToleranceDegrees: number;
      status: "not_sure";
      targetDegrees: null;
      targetDisplay: null;
    };

export type ClockingSelectionResult =
  | { error: string; valid: false }
  | { selection: ClockingSelectionSnapshot; valid: true };

interface ClockingConfiguredEndSnapshot {
  angle: string;
  sku: string;
}

export type ClockingDraftSnapshot = ClockingSelectionSnapshot & {
  configuredEnds: {
    endA: ClockingConfiguredEndSnapshot;
    endB: ClockingConfiguredEndSnapshot;
  };
  validation: "confirmed" | "retained_invalid";
};

function conventionSnapshot(
  convention: ClockingConvention,
): ClockingConventionSnapshot {
  return {
    code: convention.code,
    measurementDirection: convention.measurementDirection,
    recordVersion: convention.recordVersion,
    rendererVersion: convention.rendererVersion,
    viewDirection: convention.viewDirection,
    zeroReference: convention.zeroReference,
  };
}

export function classifyHoseEndAngle(
  angle: string,
): HoseEndAngleClassification {
  const match = angle.trim().match(/^(\d{1,3})(?:\.0+)?\s*°/u);
  if (match) return Number(match[1]) > 0 ? "angled" : "straight";
  return /straight/iu.test(angle) ? "straight" : "unknown";
}

export function evaluateAssemblyClockingApplicability(
  draft: Pick<HoseConfigurationDraft, "endA" | "endB">,
): AssemblyClockingApplicability {
  if (!draft.endA || !draft.endB) return { status: "not_applicable" };
  const endA = classifyHoseEndAngle(draft.endA.hoseEnd.angle);
  const endB = classifyHoseEndAngle(draft.endB.hoseEnd.angle);
  if (endA === "unknown" || endB === "unknown") {
    return { reason: "unknown_end_angle", status: "manual_review" };
  }
  return endA === "angled" && endB === "angled"
    ? { status: "required" }
    : { status: "not_applicable" };
}

export function requiresAssemblyClocking(
  draft: Pick<HoseConfigurationDraft, "endA" | "endB">,
): boolean {
  return evaluateAssemblyClockingApplicability(draft).status === "required";
}

export function specifyClocking(
  convention: ClockingConvention | null,
  rawTargetDegrees: string,
): ClockingSelectionResult {
  if (
    convention &&
    convention.standardToleranceDegrees !== standardClockingToleranceDegrees
  ) {
    return {
      error: "Clocking Convention M08 must use the standard ±3° tolerance.",
      valid: false,
    };
  }
  const normalizedInput = rawTargetDegrees.trim();
  if (!/^\d{1,3}$/u.test(normalizedInput)) {
    return {
      error: "Enter a whole degree from 000 through 359.",
      valid: false,
    };
  }

  const targetDegrees = Number(normalizedInput);
  const evaluation = evaluateClocking(convention, {
    status: "specified",
    targetDegrees,
    toleranceDegrees: convention?.standardToleranceDegrees ?? 0,
  });
  if (!evaluation.valid || !convention) {
    return {
      error:
        "error" in evaluation
          ? (evaluation.error ?? "Clocking selection is invalid.")
          : "Clocking Convention M08 is unavailable.",
      valid: false,
    };
  }

  return {
    selection: {
      convention: conventionSnapshot(convention),
      manualTechnicalReviewRequired: false,
      standardToleranceDegrees: convention.standardToleranceDegrees,
      status: "specified",
      targetDegrees,
      targetDisplay:
        evaluation.normalizedTarget ?? String(targetDegrees).padStart(3, "0"),
    },
    valid: true,
  };
}

export function selectClockingNotSure(
  convention: ClockingConvention | null,
): ClockingSelectionResult {
  if (
    convention &&
    convention.standardToleranceDegrees !== standardClockingToleranceDegrees
  ) {
    return {
      error: "Clocking Convention M08 must use the standard ±3° tolerance.",
      valid: false,
    };
  }
  const evaluation = evaluateClocking(convention, {
    status: "not_sure",
    targetDegrees: null,
    toleranceDegrees: convention?.standardToleranceDegrees ?? 0,
  });
  if (!evaluation.valid || !convention) {
    return {
      error:
        "error" in evaluation
          ? (evaluation.error ?? "Clocking selection is invalid.")
          : "Clocking Convention M08 is unavailable.",
      valid: false,
    };
  }

  return {
    selection: {
      convention: conventionSnapshot(convention),
      manualTechnicalReviewRequired: true,
      standardToleranceDegrees: convention.standardToleranceDegrees,
      status: "not_sure",
      targetDegrees: null,
      targetDisplay: null,
    },
    valid: true,
  };
}

export function confirmClockingForDraft(
  draft: HoseConfigurationDraft,
  clocking: ClockingSelectionSnapshot,
): ClockingDraftSnapshot | null {
  if (!draft.endA || !draft.endB) return null;
  return {
    ...clocking,
    configuredEnds: {
      endA: {
        angle: draft.endA.hoseEnd.angle,
        sku: draft.endA.hoseEnd.sku,
      },
      endB: {
        angle: draft.endB.hoseEnd.angle,
        sku: draft.endB.hoseEnd.sku,
      },
    },
    validation: "confirmed",
  };
}

function matchesConfiguredEnd(
  configured: ClockingConfiguredEndSnapshot,
  current: NonNullable<HoseConfigurationDraft["endA"]> | undefined,
) {
  return Boolean(
    current &&
    current.hoseEnd.sku === configured.sku &&
    current.hoseEnd.angle === configured.angle,
  );
}

export function attachClockingToDraft(
  draft: HoseConfigurationDraft,
  clocking: ClockingDraftSnapshot,
): HoseConfigurationDraft {
  const validation =
    clocking.validation === "confirmed" &&
    matchesConfiguredEnd(clocking.configuredEnds.endA, draft.endA) &&
    matchesConfiguredEnd(clocking.configuredEnds.endB, draft.endB) &&
    requiresAssemblyClocking(draft)
      ? "confirmed"
      : "retained_invalid";
  return { ...draft, clocking: { ...clocking, validation } };
}
