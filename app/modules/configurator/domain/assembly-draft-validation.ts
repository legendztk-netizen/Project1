import type { PublicCatalogItem } from "../../catalog/domain/public-catalog";
import {
  resolveInstalledProtectionOptionsFromEntries,
  type AssemblyEstimateSchedule,
  type ClockingConvention,
  type InstalledProtection,
  type InstalledProtectionRule,
  type LengthMeasurementMethod,
} from "../../configurator-reference/domain/configurator-reference";
import {
  evaluateAssemblyClockingApplicability,
  type ClockingDraftSnapshot,
} from "./assembly-clocking";
import {
  isExactCompatibleCandidate,
  type CompatibleHoseEndCandidate,
} from "./compatible-end-a";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";
import type {
  FinishedLengthManualReviewReason,
  MeasurementSelectionSnapshot,
} from "./finished-assembly-length";
import type { ApplicationReviewReason } from "./protection-and-application";

export type DraftValidationOwner =
  "hose" | "end-a" | "end-b" | "length" | "clocking" | "protection";

export type DraftValidationIssueKind =
  "retained_invalid" | "reconfirmation" | "technical_review" | "manual_path";

export interface DraftValidationIssue {
  code: string;
  kind: DraftValidationIssueKind;
  message: string;
  owner: DraftValidationOwner;
  retainedValue: string | null;
}

export interface HoseSelectionBasis {
  catalogReleaseId: string;
  hoseSku: string;
}

export interface AssemblySelectionBasis extends HoseSelectionBasis {
  endACompatibilityId: string;
  endAHoseEndSku: string;
  endBCompatibilityId: string;
  endBHoseEndSku: string;
}

export interface DraftSelectionProvenance {
  endA?: HoseSelectionBasis;
  endB?: HoseSelectionBasis;
  finishedLength?: AssemblySelectionBasis & {
    measurement: MeasurementSelectionBasis;
  };
  protection?: AssemblySelectionBasis & {
    applicationCode: string | null;
    finishedLengthCanonicalMm: string;
    protectionCode: string;
    protectionRecordVersion: number;
    scheduleRecordVersion: number | null;
  };
}

export type MeasurementSelectionBasis =
  | { state: "not_sure" }
  | {
      code: string;
      diagramAssetVersion: string;
      overlayVersion: string;
      recordVersion: number;
      state: "selected";
    };

export interface CompatibleCandidateSnapshot {
  candidates: CompatibleHoseEndCandidate[];
  hoseSku: string;
  releaseId: string;
}

export interface DraftValidationContext {
  activeCatalogRelease: { id: string; number: string } | null;
  assemblyEstimateSchedule: AssemblyEstimateSchedule | null;
  clockingConvention?: ClockingConvention | null;
  compatibleCandidates: CompatibleCandidateSnapshot | null;
  compatibilityCheckFailure?: HoseSelectionBasis | null;
  currentHoses: PublicCatalogItem[];
  installedProtectionRules: InstalledProtectionRule[];
  installedProtections: InstalledProtection[];
  measurementMethods: LengthMeasurementMethod[];
}

export interface AssemblyDraftValidationResult {
  blocking: boolean;
  issues: DraftValidationIssue[];
  status: "current" | "needs_attention" | "manual_review";
}

export function isBlockingDraftValidationIssue(issue: DraftValidationIssue) {
  return issue.kind === "retained_invalid" || issue.kind === "reconfirmation";
}

const ownerOrder: Record<DraftValidationOwner, number> = {
  hose: 0,
  "end-a": 1,
  "end-b": 2,
  length: 3,
  clocking: 4,
  protection: 5,
};

export function matchesHoseSelectionBasis(
  left: HoseSelectionBasis | undefined,
  right: HoseSelectionBasis,
) {
  return Boolean(
    left &&
    left.catalogReleaseId === right.catalogReleaseId &&
    left.hoseSku === right.hoseSku,
  );
}

function sameAssemblyBasis(
  left: AssemblySelectionBasis | undefined,
  right: AssemblySelectionBasis | null,
) {
  return Boolean(
    left &&
    right &&
    matchesHoseSelectionBasis(left, right) &&
    left.endACompatibilityId === right.endACompatibilityId &&
    left.endAHoseEndSku === right.endAHoseEndSku &&
    left.endBCompatibilityId === right.endBCompatibilityId &&
    left.endBHoseEndSku === right.endBHoseEndSku,
  );
}

export function captureHoseSelectionBasis(
  draft: Pick<HoseConfigurationDraft, "catalogRelease" | "hose">,
): HoseSelectionBasis {
  return {
    catalogReleaseId: draft.catalogRelease.id,
    hoseSku: draft.hose.sku,
  };
}

export function captureAssemblySelectionBasis(
  draft: Pick<
    HoseConfigurationDraft,
    "catalogRelease" | "hose" | "endA" | "endB"
  >,
): AssemblySelectionBasis | null {
  if (!draft.endA || !draft.endB) return null;
  return {
    ...captureHoseSelectionBasis(draft),
    endACompatibilityId: draft.endA.compatibilityId,
    endAHoseEndSku: draft.endA.hoseEnd.sku,
    endBCompatibilityId: draft.endB.compatibilityId,
    endBHoseEndSku: draft.endB.hoseEnd.sku,
  };
}

export function captureMeasurementSelectionBasis(
  selection: MeasurementSelectionSnapshot,
): MeasurementSelectionBasis {
  if (selection.state === "not_sure") return { state: "not_sure" };
  return {
    code: selection.method.code,
    diagramAssetVersion: selection.diagram.assetVersion,
    overlayVersion: selection.diagram.overlayVersion,
    recordVersion: selection.method.recordVersion,
    state: "selected",
  };
}

function sameMeasurementBasis(
  left: MeasurementSelectionBasis | undefined,
  selection: MeasurementSelectionSnapshot,
) {
  const right = captureMeasurementSelectionBasis(selection);
  if (!left || left.state !== right.state) return false;
  return (
    left.state === "not_sure" ||
    (right.state === "selected" &&
      left.code === right.code &&
      left.recordVersion === right.recordVersion &&
      left.diagramAssetVersion === right.diagramAssetVersion &&
      left.overlayVersion === right.overlayVersion)
  );
}

export function captureProtectionSelectionBasis(
  draft: HoseConfigurationDraft,
  schedule: AssemblyEstimateSchedule | null,
) {
  const assemblyBasis = captureAssemblySelectionBasis(draft);
  if (!assemblyBasis || !draft.finishedLength || !draft.installedProtection) {
    return null;
  }
  return {
    ...assemblyBasis,
    applicationCode: applicationCode(draft),
    finishedLengthCanonicalMm: draft.finishedLength.canonicalMm,
    protectionCode: draft.installedProtection.code,
    protectionRecordVersion: draft.installedProtection.recordVersion,
    scheduleRecordVersion: schedule?.recordVersion ?? null,
  };
}

function applicationCode(draft: HoseConfigurationDraft) {
  return draft.applicationRequirements?.fluidMedium ?? null;
}

function currentCandidate(
  snapshot: CompatibleCandidateSnapshot | null,
  draft: HoseConfigurationDraft,
  role: "endA" | "endB",
) {
  const selected = draft[role];
  if (
    !selected ||
    !snapshot ||
    snapshot.hoseSku !== draft.hose.sku ||
    snapshot.releaseId !== draft.catalogRelease.id
  ) {
    return undefined;
  }
  return snapshot.candidates.find((candidate) =>
    isExactCompatibleCandidate(candidate, selected),
  );
}

const lengthReviewMessage: Record<FinishedLengthManualReviewReason, string> = {
  both_ends_required: "Both Hose Ends must be confirmed before production.",
  finer_than_1_8_in:
    "The requested inch length uses a finer increment than 1/8 in.",
  finer_than_1_mm: "The requested metric length uses a sub-millimetre value.",
  over_50_ft: "The requested finished length is over 50 ft.",
  tighter_tolerance_requested:
    "A tighter-than-standard finished-length tolerance was requested.",
};

const applicationReviewMessage: Record<ApplicationReviewReason, string> = {
  component_limits_unavailable:
    "A selected Hose End has no published working-pressure limit and requires Technical Review.",
  component_pressure_limit_exceeded:
    "The stated system pressure exceeds a selected Hose End limit and requires a Manual Assembly Quote.",
  fluid_medium_uncertain:
    "The stated fluid medium is Other or Not Sure and requires Technical Review.",
  hose_pressure_limit_unavailable:
    "The selected Hose has no published working-pressure limit and requires Technical Review.",
  hose_pressure_limit_exceeded:
    "The stated system pressure exceeds the selected Hose limit and requires a Manual Assembly Quote.",
  hose_temperature_limit_unavailable:
    "The selected Hose has no published temperature range and requires Technical Review.",
  hose_temperature_limit_exceeded:
    "The stated operating temperature exceeds the selected Hose range and requires a Manual Assembly Quote.",
};

const manualApplicationReviewReasons = new Set<ApplicationReviewReason>([
  "component_pressure_limit_exceeded",
  "hose_pressure_limit_exceeded",
  "hose_temperature_limit_exceeded",
]);

function currentMeasurementMethod(
  draft: HoseConfigurationDraft,
  methods: LengthMeasurementMethod[],
) {
  if (draft.measurementSelection?.state !== "selected") return undefined;
  return methods.find(
    ({ code }) => code === draft.measurementSelection?.method?.code,
  );
}

function clockingConventionMatches(
  clocking: ClockingDraftSnapshot,
  current: ClockingConvention | null | undefined,
) {
  return Boolean(
    current &&
    current.code === clocking.convention.code &&
    current.recordVersion === clocking.convention.recordVersion &&
    current.rendererVersion === clocking.convention.rendererVersion &&
    current.measurementDirection === clocking.convention.measurementDirection &&
    current.viewDirection === clocking.convention.viewDirection &&
    current.zeroReference === clocking.convention.zeroReference,
  );
}

export function validateAssemblyDraft(
  draft: HoseConfigurationDraft,
  provenance: DraftSelectionProvenance,
  context: DraftValidationContext,
): AssemblyDraftValidationResult {
  const issues: DraftValidationIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: DraftValidationIssue) => {
    if (seen.has(issue.code)) return;
    seen.add(issue.code);
    issues.push(issue);
  };
  const hoseBasis = captureHoseSelectionBasis(draft);
  const assemblyBasis = captureAssemblySelectionBasis(draft);
  const currentHose = context.currentHoses.find(
    ({ sku }) => sku === draft.hose.sku,
  );

  if (
    !context.activeCatalogRelease ||
    context.activeCatalogRelease.id !== draft.catalogRelease.id
  ) {
    add({
      code: "catalog_release_changed",
      kind: "retained_invalid",
      message:
        "The selected Hose belongs to an earlier Catalog Release and remains visible for replacement.",
      owner: "hose",
      retainedValue: draft.hose.sku,
    });
  } else if (!currentHose || !currentHose.canAddToQuote) {
    add({
      code: "hose_not_currently_available",
      kind: "retained_invalid",
      message:
        "The selected Hose is no longer available for a quote and has not been replaced.",
      owner: "hose",
      retainedValue: draft.hose.sku,
    });
  }

  for (const role of ["endA", "endB"] as const) {
    const selected = draft[role];
    if (!selected) continue;
    const owner = role === "endA" ? "end-a" : "end-b";
    const label = role === "endA" ? "End A" : "End B";
    const basis = role === "endA" ? provenance.endA : provenance.endB;
    const exactCandidate = currentCandidate(
      context.compatibleCandidates,
      draft,
      role,
    );
    if (
      matchesHoseSelectionBasis(
        context.compatibilityCheckFailure ?? undefined,
        hoseBasis,
      )
    ) {
      add({
        code: `${role === "endA" ? "end_a" : "end_b"}_compatibility_check_failed`,
        kind: "technical_review",
        message: `${label} compatibility could not be refreshed and must be checked during technical review.`,
        owner,
        retainedValue: selected.hoseEnd.sku,
      });
    } else if (
      context.compatibleCandidates?.hoseSku === draft.hose.sku &&
      context.compatibleCandidates.releaseId === draft.catalogRelease.id &&
      !exactCandidate
    ) {
      add({
        code: `${role === "endA" ? "end_a" : "end_b"}_not_currently_compatible`,
        kind: "retained_invalid",
        message: `${label} ${selected.hoseEnd.sku} is retained but is not an exact current combination for this Hose.`,
        owner,
        retainedValue: selected.hoseEnd.sku,
      });
    } else if (!matchesHoseSelectionBasis(basis, hoseBasis)) {
      add({
        code: `${role === "endA" ? "end_a" : "end_b"}_reconfirmation_required`,
        kind: "reconfirmation",
        message: `${label} ${selected.hoseEnd.sku} is retained and must be confirmed for the changed Hose.`,
        owner,
        retainedValue: selected.hoseEnd.sku,
      });
    }
  }

  if (draft.measurementSelection?.state === "selected") {
    const current = currentMeasurementMethod(draft, context.measurementMethods);
    if (!current) {
      add({
        code: "measurement_method_unavailable",
        kind: "retained_invalid",
        message: `${draft.measurementSelection.method.code} is retained but is not available in the current registry.`,
        owner: "length",
        retainedValue: draft.measurementSelection.method.code,
      });
    } else if (
      current.recordVersion !==
        draft.measurementSelection.method.recordVersion ||
      current.diagramAssetVersion !==
        draft.measurementSelection.diagram.assetVersion ||
      current.overlayVersion !==
        draft.measurementSelection.diagram.overlayVersion
    ) {
      add({
        code: "measurement_method_version_changed",
        kind: "reconfirmation",
        message: `${current.code} has a newer reference version. The retained measurement selection must be confirmed.`,
        owner: "length",
        retainedValue: current.code,
      });
    }
  } else if (draft.measurementSelection?.state === "not_sure") {
    add({
      code: "measurement_method_not_sure",
      kind: "technical_review",
      message:
        "Measurement Method is Not Sure and remains assigned to manual technical review.",
      owner: "length",
      retainedValue: "Not Sure",
    });
  }

  if (draft.finishedLength && draft.measurementSelection) {
    const lengthBasis = provenance.finishedLength;
    if (
      !sameAssemblyBasis(lengthBasis, assemblyBasis) ||
      !sameMeasurementBasis(
        lengthBasis?.measurement,
        draft.measurementSelection,
      )
    ) {
      add({
        code: "finished_length_reconfirmation_required",
        kind: "reconfirmation",
        message:
          "Finished Length is retained, but an upstream Hose, Hose End or Measurement Method changed.",
        owner: "length",
        retainedValue: `${draft.finishedLength.originalValue} ${draft.finishedLength.originalUnit}`,
      });
    }
    if (draft.finishedLength.path === "manual_review") {
      for (const reason of draft.finishedLength.manualReviewReasons) {
        add({
          code: `finished_length_${reason}`,
          kind: "manual_path",
          message: lengthReviewMessage[reason],
          owner: "length",
          retainedValue: `${draft.finishedLength.originalValue} ${draft.finishedLength.originalUnit}`,
        });
      }
    }
    if (draft.finishedLength.lengthFeasibilityReviewRequired) {
      add({
        code: "finished_length_feasibility_review",
        kind: "technical_review",
        message:
          "Finished Length requires technical feasibility review until minimum finished OAL data is available.",
        owner: "length",
        retainedValue: `${draft.finishedLength.originalValue} ${draft.finishedLength.originalUnit}`,
      });
    }
  }

  const clockingApplicability = evaluateAssemblyClockingApplicability(draft);
  if (clockingApplicability.status === "manual_review") {
    add({
      code: "clocking_unknown_end_angle",
      kind: "technical_review",
      message:
        "One retained Hose End has an unclassified angle. No M08 value is assumed automatically.",
      owner: "clocking",
      retainedValue: null,
    });
  }

  if (draft.clocking) {
    if (
      draft.clocking.validation === "retained_invalid" ||
      !clockingConventionMatches(draft.clocking, context.clockingConvention)
    ) {
      add({
        code: "clocking_reconfirmation_required",
        kind: "reconfirmation",
        message:
          "Clocking is retained but the selected ends or current M08 convention changed.",
        owner: "clocking",
        retainedValue:
          draft.clocking.status === "specified"
            ? `${draft.clocking.targetDisplay}°`
            : "Not Sure",
      });
    } else if (draft.clocking.status === "not_sure") {
      add({
        code: "clocking_not_sure",
        kind: "manual_path",
        message: "Clocking is Not Sure and remains assigned to manual review.",
        owner: "clocking",
        retainedValue: "Not Sure",
      });
    }
  }

  if (draft.installedProtection) {
    const protection = context.installedProtections.find(
      ({ code }) => code === draft.installedProtection?.code,
    );
    const allowed = resolveInstalledProtectionOptionsFromEntries(
      context.installedProtections,
      context.installedProtectionRules,
      {
        applicationCode: applicationCode(draft),
        hoseSeries: draft.hose.series,
      },
    ).some(({ code }) => code === draft.installedProtection?.code);
    if (!protection || protection.availability !== "available" || !allowed) {
      add({
        code: "protection_not_currently_available",
        kind: "retained_invalid",
        message: `${draft.installedProtection.publicName} is retained but is not allowed by the current protection registry.`,
        owner: "protection",
        retainedValue: draft.installedProtection.publicName,
      });
    } else if (
      provenance.protection &&
      protection.recordVersion !== provenance.protection.protectionRecordVersion
    ) {
      add({
        code: "protection_version_changed",
        kind: "reconfirmation",
        message: `${protection.publicName} has a newer registry version and must be confirmed.`,
        owner: "protection",
        retainedValue: protection.publicName,
      });
    }

    const protectionBasis = provenance.protection;
    if (
      !sameAssemblyBasis(protectionBasis, assemblyBasis) ||
      protectionBasis?.finishedLengthCanonicalMm !==
        draft.finishedLength?.canonicalMm ||
      protectionBasis?.applicationCode !== applicationCode(draft) ||
      protectionBasis?.scheduleRecordVersion !==
        context.assemblyEstimateSchedule?.recordVersion
    ) {
      add({
        code: "protection_reconfirmation_required",
        kind: "reconfirmation",
        message:
          "Installed Protection and its estimate are retained, but an upstream selection or price schedule changed.",
        owner: "protection",
        retainedValue: draft.installedProtection.publicName,
      });
    }
  }

  if (draft.applicationRequirements?.technicalReviewRequired) {
    for (const reason of draft.applicationRequirements.reviewReasons) {
      add({
        code: `operating_conditions_${reason}`,
        kind: manualApplicationReviewReasons.has(reason)
          ? "manual_path"
          : "technical_review",
        message: applicationReviewMessage[reason],
        owner: "protection",
        retainedValue: draft.applicationRequirements.fluidMedium,
      });
    }
  }

  issues.sort(
    (left, right) =>
      ownerOrder[left.owner] - ownerOrder[right.owner] ||
      left.code.localeCompare(right.code),
  );
  const blocking = issues.some(isBlockingDraftValidationIssue);
  return {
    blocking,
    issues,
    status:
      issues.length === 0
        ? "current"
        : blocking
          ? "needs_attention"
          : "manual_review",
  };
}
