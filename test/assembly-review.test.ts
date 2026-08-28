import { describe, expect, it } from "vitest";

import type { AssemblyDraftValidationResult } from "../app/modules/configurator/domain/assembly-draft-validation";
import {
  evaluateAssemblyReview,
  type AssemblyReviewInput,
} from "../app/modules/configurator/domain/assembly-review";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import type { HoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";
import { publicHoseFixture } from "./fixtures/public-hose";

function completeDraft(): HoseConfigurationDraft {
  const hose = createHoseConfigurationDraft(publicHoseFixture());
  if (!hose) throw new Error("Expected a Hose draft");
  const candidate = compatibleEndAFixture();
  return {
    ...attachEndBToDraft(attachEndAToDraft(hose, candidate), candidate),
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
    installedProtection: {
      availability: "available",
      code: "NONE",
      currency: "USD",
      isNoAdditionalProtection: true,
      publicName: "No additional installed protection",
      recordVersion: 2,
      referenceBasePriceUsd: 0,
      referenceInstallationPricePerStartedFootUsd: 0,
      referenceMaterialPricePerFootUsd: 0,
      referencePriceUsd: 0,
      specification: "No installed sleeve or guard",
    },
    lengthReferencePricing: {
      assemblyServiceUsd: 3,
      exactLengthFeet: 6,
      missingInputs: [],
      protectionUsd: 0,
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
}

function validation(
  overrides: Partial<AssemblyDraftValidationResult> = {},
): AssemblyDraftValidationResult {
  return {
    blocking: false,
    issues: [],
    status: "current",
    ...overrides,
  };
}

function input(
  overrides: Partial<AssemblyReviewInput> = {},
): AssemblyReviewInput {
  return {
    draft: completeDraft(),
    quantityInput: "1",
    validation: validation(),
    ...overrides,
  };
}

describe("assembly review", () => {
  it("marks a complete current draft ready for the configured Quote List", () => {
    const result = evaluateAssemblyReview(input());

    expect(result.outcome).toBe("ready");
    expect(result.canAddConfiguredLine).toBe(true);
    expect(result.quantity).toBe(1);
    expect(result.missingRequirements).toEqual([]);
  });

  it("keeps Measurement Not Sure quotable with Technical Review Required", () => {
    const result = evaluateAssemblyReview(
      input({
        validation: validation({
          issues: [
            {
              code: "measurement_method_not_sure",
              kind: "technical_review",
              message: "Measurement Method is Not Sure.",
              owner: "length",
              retainedValue: "Not Sure",
            },
          ],
          status: "manual_review",
        }),
      }),
    );

    expect(result.outcome).toBe("technical_review");
    expect(result.canAddConfiguredLine).toBe(true);
  });

  it("routes unsupported guided length to a Manual Assembly Quote Request", () => {
    const result = evaluateAssemblyReview(
      input({
        validation: validation({
          issues: [
            {
              code: "finished_length_over_50_ft",
              kind: "manual_path",
              message: "The requested finished length is over 50 ft.",
              owner: "length",
              retainedValue: "601 in",
            },
          ],
          status: "manual_review",
        }),
      }),
    );

    expect(result.outcome).toBe("manual_quote");
    expect(result.canAddConfiguredLine).toBe(false);
  });

  it("blocks incomplete, invalid or non-integer quantity states", () => {
    const withoutEndB = completeDraft();
    delete withoutEndB.endB;
    expect(evaluateAssemblyReview(input({ draft: withoutEndB })).outcome).toBe(
      "blocked",
    );

    const invalidSelection = validation({
      blocking: true,
      issues: [
        {
          code: "end_b_not_currently_compatible",
          kind: "retained_invalid",
          message: "End B is not currently compatible.",
          owner: "end-b",
          retainedValue: "JIC_F_SW_04_04",
        },
      ],
      status: "needs_attention",
    });
    expect(
      evaluateAssemblyReview(input({ validation: invalidSelection })).outcome,
    ).toBe("blocked");

    const invalidQuantity = evaluateAssemblyReview(
      input({ quantityInput: "1.5" }),
    );
    expect(invalidQuantity.outcome).toBe("blocked");
    expect(invalidQuantity.quantity).toBeNull();
    expect(invalidQuantity.quantityError).toContain("whole number");
  });
});
