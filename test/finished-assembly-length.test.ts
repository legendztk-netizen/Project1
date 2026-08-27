import { describe, expect, it } from "vitest";

import type { LengthMeasurementMethod } from "../app/modules/configurator-reference/domain/configurator-reference";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import {
  attachFinishedLengthToDraft,
  attachMeasurementSelectionToDraft,
  evaluateFinishedAssemblyLength,
  selectMeasurementMethod,
  selectMeasurementNotSure,
} from "../app/modules/configurator/domain/finished-assembly-length";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import { publicHoseFixture } from "./fixtures/public-hose";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";

function method(
  code: LengthMeasurementMethod["code"],
): LengthMeasurementMethod {
  return {
    code,
    diagramAssetKey: `${code}-diagram.png`,
    diagramAssetVersion: "diagram-2.4.0",
    displayName: `${code} measurement`,
    endpointRule: `${code} endpoint rule`,
    overlayVersion: "1.0.1",
    recordVersion: 3,
  };
}

describe("finished assembly length", () => {
  it.each(["M01", "M02", "M03", "M04", "M05", "M06", "M07"] as const)(
    "snapshots an explicit %s method without inferring from hose ends",
    (code) => {
      expect(selectMeasurementMethod(method(code))).toEqual({
        diagram: {
          assetKey: `${code}-diagram.png`,
          assetVersion: "diagram-2.4.0",
          overlayVersion: "1.0.1",
        },
        method: method(code),
        state: "selected",
      });
    },
  );

  it("stores Not Sure explicitly without a method or diagram", () => {
    expect(selectMeasurementNotSure()).toEqual({
      diagram: null,
      manualTechnicalReviewRequired: true,
      method: null,
      state: "not_sure",
    });
  });

  it.each([
    ["in", "0.125", "3.175"],
    ["in", "72", "1828.8"],
    ["mm", "1", "1"],
    ["mm", "15240", "15240"],
  ] as const)(
    "preserves %s input %s and converts exactly to %s mm",
    (unit, value, canonicalMm) => {
      const result = evaluateFinishedAssemblyLength({
        hasBothEnds: true,
        requestedTighterTolerance: false,
        unit,
        value,
      });

      expect(result.valid).toBe(true);
      if (!result.valid) throw new Error("Expected a valid result");
      expect(result.length.originalValue).toBe(value);
      expect(result.length.originalUnit).toBe(unit);
      expect(result.length.canonicalMm).toBe(canonicalMm);
      expect(result.length.lengthFeasibilityReviewRequired).toBe(true);
    },
  );

  it.each([
    ["12", "up_to_12_in", "3.175"],
    ["12.125", "over_12_through_18_in", "4.7625"],
    ["18.125", "over_18_through_36_in", "6.35"],
    ["36.125", "over_36_in", "9.17575"],
  ] as const)(
    "snapshots the SAE J517 tolerance for %s inches",
    (value, band, toleranceMm) => {
      const result = evaluateFinishedAssemblyLength({
        hasBothEnds: true,
        requestedTighterTolerance: false,
        unit: "in",
        value,
      });

      expect(result.valid).toBe(true);
      if (!result.valid) throw new Error("Expected a valid result");
      expect(result.length.tolerance.scheduleCode).toBe(
        "SAE_J517_ASSEMBLY_LENGTH",
      );
      expect(result.length.tolerance.scheduleVersion).toBe("1.0.0");
      expect(result.length.tolerance.band).toBe(band);
      expect(result.length.tolerance.plusMinusCanonicalMm).toBe(toleranceMm);
    },
  );

  it("keeps the 50-foot boundary guided and routes longer lengths to manual review", () => {
    const boundary = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: false,
      unit: "in",
      value: "600",
    });
    const longer = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: false,
      unit: "in",
      value: "600.125",
    });

    expect(boundary.valid && boundary.length.path).toBe("guided");
    expect(longer.valid && longer.length.path).toBe("manual_review");
    expect(longer.valid && longer.length.manualReviewReasons).toContain(
      "over_50_ft",
    );
  });

  it.each([
    ["in", "1.01", "finer_than_1_8_in"],
    ["mm", "1.5", "finer_than_1_mm"],
  ] as const)(
    "routes finer %s precision to manual review",
    (unit, value, reason) => {
      const result = evaluateFinishedAssemblyLength({
        hasBothEnds: true,
        requestedTighterTolerance: false,
        unit,
        value,
      });

      expect(result.valid).toBe(true);
      expect(result.valid && result.length.path).toBe("manual_review");
      expect(result.valid && result.length.manualReviewReasons).toContain(
        reason,
      );
    },
  );

  it("routes tighter-tolerance and single-end requests to manual review", () => {
    const tighter = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: true,
      unit: "in",
      value: "24",
    });
    const singleEnd = evaluateFinishedAssemblyLength({
      hasBothEnds: false,
      requestedTighterTolerance: false,
      unit: "in",
      value: "24",
    });

    expect(tighter.valid && tighter.length.manualReviewReasons).toContain(
      "tighter_tolerance_requested",
    );
    expect(singleEnd.valid && singleEnd.length.manualReviewReasons).toContain(
      "both_ends_required",
    );
  });

  it.each(["0", "-1", "", "abc"])("rejects invalid input %j", (value) => {
    expect(
      evaluateFinishedAssemblyLength({
        hasBothEnds: true,
        requestedTighterTolerance: false,
        unit: "mm",
        value,
      }).valid,
    ).toBe(false);
  });

  it("attaches measurement and length snapshots to the page-session draft", () => {
    const draft = createHoseConfigurationDraft(publicHoseFixture());
    if (!draft) throw new Error("Expected a draft");
    const withEndA = attachEndAToDraft(draft, compatibleEndAFixture());
    const withBothEnds = attachEndBToDraft(withEndA, compatibleEndAFixture());
    const selection = selectMeasurementMethod(method("M04"));
    const evaluated = evaluateFinishedAssemblyLength({
      hasBothEnds: true,
      requestedTighterTolerance: false,
      unit: "in",
      value: "72",
    });
    if (!evaluated.valid) throw new Error("Expected a valid length");

    const withMeasurement = attachMeasurementSelectionToDraft(
      withBothEnds,
      selection,
    );
    const complete = attachFinishedLengthToDraft(
      withMeasurement,
      evaluated.length,
    );

    expect(complete.measurementSelection).toEqual(selection);
    expect(complete.finishedLength?.canonicalMm).toBe("1828.8");
  });
});
