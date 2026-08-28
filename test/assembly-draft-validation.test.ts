import { describe, expect, it } from "vitest";

import type { PublicCatalogItem } from "../app/modules/catalog/domain/public-catalog";
import type { HoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import {
  captureAssemblySelectionBasis,
  captureHoseSelectionBasis,
  captureMeasurementSelectionBasis,
  isBlockingDraftValidationIssue,
  validateAssemblyDraft,
  type DraftSelectionProvenance,
  type DraftValidationContext,
} from "../app/modules/configurator/domain/assembly-draft-validation";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import type { InstalledProtection } from "../app/modules/configurator-reference/domain/configurator-reference";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";
import { publicHoseFixture } from "./fixtures/public-hose";

const nylonProtection: InstalledProtection = {
  availability: "available",
  code: "NYLON",
  currency: "USD",
  isNoAdditionalProtection: false,
  publicName: "Nylon Protective Sleeving",
  recordVersion: 2,
  referenceBasePriceUsd: 8,
  referenceInstallationPricePerStartedFootUsd: 1,
  referenceMaterialPricePerFootUsd: 1.35,
  referencePriceUsd: null,
  specification: "Abrasion-resistant nylon sleeve",
};

function completeDraft() {
  const hose = createHoseConfigurationDraft(publicHoseFixture());
  if (!hose) throw new Error("Expected hose draft");
  const candidate = compatibleEndAFixture();
  const withEnds = attachEndBToDraft(
    attachEndAToDraft(hose, candidate),
    candidate,
  );
  const draft: HoseConfigurationDraft = {
    ...withEnds,
    finishedLength: {
      canonicalMm: "1828.8",
      lengthFeasibilityReviewRequired: true,
      manualReviewReasons: [],
      originalUnit: "in",
      originalValue: "72",
      path: "guided",
      requestedTighterTolerance: false,
      tolerance: {
        band: "over_36_in",
        display: "± 1% (± 18.288 mm)",
        percent: 1,
        plusMinusCanonicalMm: "18.288",
        scheduleCode: "SAE_J517_ASSEMBLY_LENGTH",
        scheduleVersion: "1.0.0",
      },
    },
    installedProtection: nylonProtection,
    lengthReferencePricing: {
      assemblyServiceUsd: 3,
      exactLengthFeet: 6,
      missingInputs: [],
      protectionUsd: 22.1,
      scheduleRecordVersion: 2,
      startedFeet: 6,
    },
    measurementSelection: {
      diagram: {
        assetKey: "M04.png",
        assetVersion: "diagram-1.0.1",
        overlayVersion: "1.0.1",
      },
      method: {
        code: "M04",
        diagramAssetKey: "M04.png",
        diagramAssetVersion: "diagram-1.0.1",
        displayName: "Straight to 90° elbow",
        endpointRule: "Measure sealing point to elbow centerline",
        overlayVersion: "1.0.1",
        recordVersion: 2,
      },
      state: "selected",
    },
  };
  return { candidate, draft };
}

function provenanceFor(
  draft: HoseConfigurationDraft,
): DraftSelectionProvenance {
  const hoseBasis = captureHoseSelectionBasis(draft);
  const assemblyBasis = captureAssemblySelectionBasis(draft);
  if (!assemblyBasis || !draft.measurementSelection || !draft.finishedLength) {
    throw new Error("Expected complete draft");
  }
  return {
    endA: hoseBasis,
    endB: hoseBasis,
    finishedLength: {
      ...assemblyBasis,
      measurement: captureMeasurementSelectionBasis(draft.measurementSelection),
    },
    protection: {
      ...assemblyBasis,
      applicationCode: null,
      finishedLengthCanonicalMm: draft.finishedLength.canonicalMm,
      protectionCode: "NYLON",
      protectionRecordVersion: 2,
      scheduleRecordVersion: 2,
    },
  };
}

function contextFor(
  hose: PublicCatalogItem,
  candidate = compatibleEndAFixture(),
): DraftValidationContext {
  return {
    activeCatalogRelease: {
      id: hose.releaseId,
      number: hose.releaseNumber,
    },
    assemblyEstimateSchedule: {
      assemblyServicePricePerStartedFootUsd: 0.5,
      assemblyServicePriceUsd: null,
      currency: "USD",
      ferrulePriceSource: "catalog_sales_offer",
      hoseEndPriceSource: "catalog_sales_offer",
      hosePriceSource: "catalog_sales_offer_per_ft",
      protectionPriceSource: "installed_protection_registry",
      recordVersion: 2,
    },
    compatibleCandidates: {
      candidates: [candidate],
      hoseSku: hose.sku,
      releaseId: hose.releaseId,
    },
    currentHoses: [hose],
    installedProtectionRules: [],
    installedProtections: [nylonProtection],
    measurementMethods: [
      {
        code: "M04",
        diagramAssetKey: "M04.png",
        diagramAssetVersion: "diagram-1.0.1",
        displayName: "Straight to 90° elbow",
        endpointRule: "Measure sealing point to elbow centerline",
        overlayVersion: "1.0.1",
        recordVersion: 2,
      },
    ],
  };
}

describe("assembly draft validation", () => {
  it("keeps a current complete draft on its declared technical-review path", () => {
    const { candidate, draft } = completeDraft();
    const result = validateAssemblyDraft(
      draft,
      provenanceFor(draft),
      contextFor(publicHoseFixture(), candidate),
    );

    expect(result.issues).toMatchObject([
      {
        code: "finished_length_feasibility_review",
        kind: "technical_review",
        owner: "length",
      },
    ]);
    expect(result.blocking).toBe(false);
    expect(result.status).toBe("manual_review");
  });

  it("retains downstream values and assigns reconfirmation to affected steps after a Hose change", () => {
    const { candidate, draft } = completeDraft();
    const provenance = provenanceFor(draft);
    const originalSelection = publicHoseFixture().variantSelection;
    if (originalSelection?.kind !== "hose") {
      throw new Error("Expected Hose variant selection");
    }
    const nextHose = publicHoseFixture({
      displayName: "601R1 Hydraulic Hose -4",
      sku: "601R1_002",
      variantSelection: {
        ...originalSelection,
        dash: "-4",
        kind: "hose",
        nominalIdIn: 0.25,
      },
    });
    const nextDraft = {
      ...draft,
      hose: {
        ...draft.hose,
        dash: "-4" as const,
        nominalIdIn: 0.25,
        sku: "601R1_002",
      },
    };

    const result = validateAssemblyDraft(
      nextDraft,
      provenance,
      contextFor(nextHose, candidate),
    );

    expect(nextDraft.endA).toEqual(draft.endA);
    expect(nextDraft.finishedLength).toEqual(draft.finishedLength);
    expect(nextDraft.installedProtection).toEqual(draft.installedProtection);
    expect(
      result.issues
        .filter(({ kind }) => kind === "reconfirmation")
        .map(({ owner }) => owner),
    ).toEqual(["end-a", "end-b", "length", "protection"]);
  });

  it("marks only the exact retained End whose current compatibility disappeared", () => {
    const { draft } = completeDraft();
    const context = contextFor(publicHoseFixture());
    context.compatibleCandidates = {
      candidates: [],
      hoseSku: draft.hose.sku,
      releaseId: draft.catalogRelease.id,
    };

    const result = validateAssemblyDraft(draft, provenanceFor(draft), context);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "end_a_not_currently_compatible",
          owner: "end-a",
        }),
        expect.objectContaining({
          code: "end_b_not_currently_compatible",
          owner: "end-b",
        }),
      ]),
    );
    expect(result.blocking).toBe(true);
  });

  for (const role of ["A", "B"] as const) {
    it(`retains unrelated values and assigns only downstream issues after End ${role} changes`, () => {
      const { candidate, draft } = completeDraft();
      const provenance = provenanceFor(draft);
      const replacement = compatibleEndAFixture({
        compatibilityId: "COMP_0012",
        displayName: "NPTF Male Fixed Straight Hose End",
        hoseEndSku: "NPT_M_FX_04_04",
      });
      const changedDraft =
        role === "A"
          ? attachEndAToDraft(draft, replacement)
          : attachEndBToDraft(draft, replacement);
      const changedProvenance: DraftSelectionProvenance = {
        ...provenance,
        ...(role === "A"
          ? { endA: captureHoseSelectionBasis(changedDraft) }
          : { endB: captureHoseSelectionBasis(changedDraft) }),
      };
      const context = contextFor(publicHoseFixture(), candidate);
      if (context.compatibleCandidates) {
        context.compatibleCandidates.candidates = [candidate, replacement];
      }

      const result = validateAssemblyDraft(
        changedDraft,
        changedProvenance,
        context,
      );

      expect(changedDraft.finishedLength).toEqual(draft.finishedLength);
      expect(changedDraft.installedProtection).toEqual(
        draft.installedProtection,
      );
      expect(changedDraft[role === "A" ? "endB" : "endA"]).toEqual(
        draft[role === "A" ? "endB" : "endA"],
      );
      expect(
        result.issues
          .filter(({ kind }) => kind === "reconfirmation")
          .map(({ owner }) => owner),
      ).toEqual(["length", "protection"]);
    });
  }

  it("assigns registry-version drift only to the selections that use it", () => {
    const { draft } = completeDraft();
    const context = contextFor(publicHoseFixture());
    context.measurementMethods = [
      { ...context.measurementMethods[0], recordVersion: 3 },
    ];
    context.installedProtections = [{ ...nylonProtection, recordVersion: 3 }];

    const result = validateAssemblyDraft(draft, provenanceFor(draft), context);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "measurement_method_version_changed",
          owner: "length",
        }),
        expect.objectContaining({
          code: "protection_version_changed",
          owner: "protection",
        }),
      ]),
    );
  });

  it("returns explicit manual and technical-review reasons in the same result", () => {
    const { draft } = completeDraft();
    if (!draft.endA || !draft.finishedLength) {
      throw new Error("Expected complete draft");
    }
    const reviewDraft: HoseConfigurationDraft = {
      ...draft,
      endA: {
        ...draft.endA,
        hoseEnd: { ...draft.endA.hoseEnd, angle: "Custom angle" },
      },
      finishedLength: {
        ...draft.finishedLength,
        manualReviewReasons: ["over_50_ft", "tighter_tolerance_requested"],
        path: "manual_review",
        requestedTighterTolerance: true,
      },
    };

    const result = validateAssemblyDraft(
      reviewDraft,
      provenanceFor(draft),
      contextFor(publicHoseFixture()),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "finished_length_over_50_ft",
          kind: "manual_path",
          owner: "length",
        }),
        expect.objectContaining({
          code: "finished_length_tighter_tolerance_requested",
          kind: "manual_path",
          owner: "length",
        }),
        expect.objectContaining({
          code: "finished_length_feasibility_review",
          kind: "technical_review",
          owner: "length",
        }),
        expect.objectContaining({
          code: "clocking_unknown_end_angle",
          kind: "technical_review",
          owner: "clocking",
        }),
      ]),
    );
  });

  it("separates exceeded operating limits from uncertain application data", () => {
    const { draft } = completeDraft();
    const exceededDraft: HoseConfigurationDraft = {
      ...draft,
      applicationRequirements: {
        fluidMedium: "petroleum_hydraulic_fluid",
        maximumOperatingTemperature: {
          canonicalC: "120",
          originalUnit: "C",
          originalValue: "120",
        },
        maximumWorkingPressure: {
          canonicalBar: "300",
          originalUnit: "bar",
          originalValue: "300",
        },
        minimumOperatingTemperature: {
          canonicalC: "-40",
          originalUnit: "C",
          originalValue: "-40",
        },
        reviewReasons: [
          "component_pressure_limit_exceeded",
          "hose_temperature_limit_exceeded",
        ],
        technicalReviewRequired: true,
      },
    };
    const exceededProvenance = provenanceFor(exceededDraft);
    if (exceededProvenance.protection) {
      exceededProvenance.protection.applicationCode =
        "petroleum_hydraulic_fluid";
    }

    const exceeded = validateAssemblyDraft(
      exceededDraft,
      exceededProvenance,
      contextFor(publicHoseFixture()),
    );
    expect(exceeded.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "operating_conditions_component_pressure_limit_exceeded",
          kind: "manual_path",
        }),
        expect.objectContaining({
          code: "operating_conditions_hose_temperature_limit_exceeded",
          kind: "manual_path",
        }),
      ]),
    );

    const uncertainDraft: HoseConfigurationDraft = {
      ...exceededDraft,
      applicationRequirements: {
        ...exceededDraft.applicationRequirements!,
        fluidMedium: "not_sure",
        reviewReasons: ["fluid_medium_uncertain"],
      },
    };
    const uncertainProvenance = provenanceFor(uncertainDraft);
    if (uncertainProvenance.protection) {
      uncertainProvenance.protection.applicationCode = "not_sure";
    }
    const uncertain = validateAssemblyDraft(
      uncertainDraft,
      uncertainProvenance,
      contextFor(publicHoseFixture()),
    );
    expect(uncertain.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "operating_conditions_fluid_medium_uncertain",
          kind: "technical_review",
        }),
      ]),
    );
  });

  it("clears reconfirmation automatically when the original upstream state is restored", () => {
    const { candidate, draft } = completeDraft();
    const provenance = provenanceFor(draft);
    const changedDraft = {
      ...draft,
      hose: { ...draft.hose, sku: "601R1_002" },
    };
    expect(
      validateAssemblyDraft(
        changedDraft,
        provenance,
        contextFor(publicHoseFixture({ sku: "601R1_002" }), candidate),
      ).issues.length,
    ).toBeGreaterThan(0);

    expect(
      validateAssemblyDraft(
        draft,
        provenance,
        contextFor(publicHoseFixture(), candidate),
      ).issues.filter(isBlockingDraftValidationIssue),
    ).toEqual([]);
  });
});
