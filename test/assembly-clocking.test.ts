import { describe, expect, it } from "vitest";

import type { ClockingConvention } from "../app/modules/configurator-reference/domain/configurator-reference";
import {
  attachClockingToDraft,
  classifyHoseEndAngle,
  confirmClockingForDraft,
  evaluateAssemblyClockingApplicability,
  requiresAssemblyClocking,
  selectClockingNotSure,
  specifyClocking,
} from "../app/modules/configurator/domain/assembly-clocking";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";
import { publicHoseFixture } from "./fixtures/public-hose";

const convention: ClockingConvention = {
  acceptedMaximumDegrees: 359,
  acceptedMinimumDegrees: 0,
  code: "M08",
  measurementDirection: "clockwise",
  notSureOutcome: "manual_review",
  presets: [0, 45, 90, 135, 180, 225, 270, 315],
  recordVersion: 4,
  rendererVersion: "1.2.0",
  standardToleranceDegrees: 3,
  tighterToleranceOutcome: "manual_review",
  viewDirection: "end_a_toward_end_b",
  zeroReference: "end_b_at_6_oclock",
};

function draftWithAngles(endAAngle: string, endBAngle: string) {
  const base = createHoseConfigurationDraft(publicHoseFixture());
  if (!base) throw new Error("Expected fixture hose to be eligible");
  return attachEndBToDraft(
    attachEndAToDraft(base, compatibleEndAFixture({ angle: endAAngle })),
    compatibleEndAFixture({
      angle: endBAngle,
      compatibilityId: "COMP_B",
      hoseEndSku: "JIC90_F_SW_04_04",
    }),
  );
}

describe("assembly Clocking", () => {
  it("requires M08 only when both hose ends are angled", () => {
    expect(
      requiresAssemblyClocking(draftWithAngles("0° Straight", "90°")),
    ).toBe(false);
    expect(
      requiresAssemblyClocking(draftWithAngles("45°", "0° Straight")),
    ).toBe(false);
    expect(requiresAssemblyClocking(draftWithAngles("45°", "90°"))).toBe(true);
    expect(classifyHoseEndAngle("Other")).toBe("unknown");
    expect(
      evaluateAssemblyClockingApplicability(draftWithAngles("Other", "90°")),
    ).toEqual({ reason: "unknown_end_angle", status: "manual_review" });
    expect(requiresAssemblyClocking(draftWithAngles("Other", "90°"))).toBe(
      false,
    );
  });

  it("accepts 000 and 359 without silently preselecting either", () => {
    expect(specifyClocking(convention, "").valid).toBe(false);
    expect(specifyClocking(convention, "000")).toMatchObject({
      selection: { targetDegrees: 0, targetDisplay: "000" },
      valid: true,
    });
    expect(specifyClocking(convention, "359")).toMatchObject({
      selection: { targetDegrees: 359, targetDisplay: "359" },
      valid: true,
    });
  });

  it("rejects decimals, signs, and values outside 000 through 359", () => {
    for (const invalid of ["-1", "+45", "45.5", "360", "999"]) {
      expect(specifyClocking(convention, invalid).valid).toBe(false);
    }
  });

  it("snapshots convention and renderer versions with the standard tolerance", () => {
    expect(specifyClocking(convention, "90")).toEqual({
      selection: {
        convention: {
          code: "M08",
          measurementDirection: "clockwise",
          recordVersion: 4,
          rendererVersion: "1.2.0",
          viewDirection: "end_a_toward_end_b",
          zeroReference: "end_b_at_6_oclock",
        },
        manualTechnicalReviewRequired: false,
        standardToleranceDegrees: 3,
        status: "specified",
        targetDegrees: 90,
        targetDisplay: "090",
      },
      valid: true,
    });
  });

  it("stores Not Sure without a target and requires manual review", () => {
    expect(selectClockingNotSure(convention)).toMatchObject({
      selection: {
        manualTechnicalReviewRequired: true,
        status: "not_sure",
        targetDegrees: null,
        targetDisplay: null,
      },
      valid: true,
    });
  });

  it("fails closed when the published convention does not use ±3 degrees", () => {
    const invalidConvention = {
      ...convention,
      standardToleranceDegrees: 5,
    };
    expect(specifyClocking(invalidConvention, "090")).toEqual({
      error: "Clocking Convention M08 must use the standard ±3° tolerance.",
      valid: false,
    });
    expect(selectClockingNotSure(invalidConvention).valid).toBe(false);
  });

  it("retains but invalidates saved Clocking when either configured end changes", () => {
    const originalDraft = draftWithAngles("45°", "90°");
    const selected = specifyClocking(convention, "135");
    if (!selected.valid) throw new Error("Expected valid Clocking selection");
    const confirmed = confirmClockingForDraft(
      originalDraft,
      selected.selection,
    );
    if (!confirmed) throw new Error("Expected Clocking confirmation snapshot");

    expect(
      attachClockingToDraft(originalDraft, confirmed).clocking?.validation,
    ).toBe("confirmed");
    const changedDraft = attachEndBToDraft(
      originalDraft,
      compatibleEndAFixture({
        angle: "0° Straight",
        compatibilityId: "COMP_CHANGED",
        hoseEndSku: "JIC_F_SW_04_04",
      }),
    );
    expect(
      attachClockingToDraft(changedDraft, confirmed).clocking,
    ).toMatchObject({
      status: "specified",
      targetDisplay: "135",
      validation: "retained_invalid",
    });
  });
});
