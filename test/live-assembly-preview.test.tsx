// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ClockingConvention } from "../app/modules/configurator-reference/domain/configurator-reference";
import {
  confirmClockingForDraft,
  specifyClocking,
} from "../app/modules/configurator/domain/assembly-clocking";
import {
  attachEndAToDraft,
  attachEndBToDraft,
} from "../app/modules/configurator/domain/compatible-end-a";
import {
  attachFinishedLengthToDraft,
  attachMeasurementSelectionToDraft,
  evaluateFinishedAssemblyLength,
  selectMeasurementNotSure,
} from "../app/modules/configurator/domain/finished-assembly-length";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import { LiveAssemblyPreview } from "../app/modules/storefront/ui/live-assembly-preview";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";
import { publicHoseFixture } from "./fixtures/public-hose";

afterEach(cleanup);

const clockingConvention: ClockingConvention = {
  acceptedMaximumDegrees: 359,
  acceptedMinimumDegrees: 0,
  code: "M08",
  measurementDirection: "clockwise",
  notSureOutcome: "manual_review",
  presets: [0, 45, 90, 135, 180, 225, 270, 315],
  recordVersion: 2,
  rendererVersion: "1.0.1",
  standardToleranceDegrees: 3,
  tighterToleranceOutcome: "manual_review",
  viewDirection: "end_a_toward_end_b",
  zeroReference: "end_b_at_6_oclock",
};

function assemblyDraft({
  clockingAngle,
  endAAngle = "0° Straight",
  endBAngle = "45°",
  includeProtection = true,
  lengthValue = "72",
}: {
  clockingAngle?: number;
  endAAngle?: string;
  endBAngle?: string;
  includeProtection?: boolean;
  lengthValue?: string;
} = {}) {
  const hose = createHoseConfigurationDraft(publicHoseFixture());
  if (!hose) throw new Error("Expected a hose draft");
  const endA = compatibleEndAFixture({
    angle: endAAngle,
    displayName: `JIC End A ${endAAngle}`,
    hoseEndSku: "JIC_END_A",
  });
  const endB = compatibleEndAFixture({
    angle: endBAngle,
    compatibilityId: "COMP_0022",
    displayName: `ORFS End B ${endBAngle}`,
    hoseEndSku: "ORFS_END_B",
    interfaceFamily: "ORFS",
    interfaceGroup: "ORFS",
  });
  let draft = attachMeasurementSelectionToDraft(
    attachEndBToDraft(attachEndAToDraft(hose, endA), endB),
    selectMeasurementNotSure(),
  );
  const length = evaluateFinishedAssemblyLength({
    hasBothEnds: true,
    requestedTighterTolerance: false,
    unit: "in",
    value: lengthValue,
  });
  if (!length.valid) throw new Error(length.error);
  draft = attachFinishedLengthToDraft(draft, length.length);
  if (includeProtection) {
    draft = {
      ...draft,
      installedProtection: {
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
      },
    };
  }
  if (clockingAngle !== undefined) {
    const selection = specifyClocking(
      clockingConvention,
      String(clockingAngle),
    );
    if (!selection.valid) throw new Error(selection.error);
    const confirmed = confirmClockingForDraft(draft, selection.selection);
    if (!confirmed) throw new Error("Expected confirmed Clocking");
    draft = { ...draft, clocking: confirmed };
  }
  return draft;
}

describe("LiveAssemblyPreview", () => {
  it("renders component forms and customer inputs with deterministic text", () => {
    render(
      <LiveAssemblyPreview
        draft={assemblyDraft()}
        issues={[
          {
            code: "finished_length_feasibility_review",
            kind: "technical_review",
            message: "Finished length requires feasibility review.",
            owner: "length",
            retainedValue: "72 in",
          },
        ]}
      />,
    );

    const diagram = screen.getByRole("img", {
      name: /Hose 601R1_001.*End A JIC_END_A, straight.*End B ORFS_END_B, 45 degree.*Finished length 72 in.*Nylon Protective Sleeving.*Not to scale/i,
    });
    expect(diagram.getAttribute("data-end-a-form")).toBe("straight");
    expect(diagram.getAttribute("data-end-b-form")).toBe("45-degree");
    expect(screen.getByText(/Assembly preview · Not to scale/)).toBeTruthy();

    const specification = screen.getByRole("region", {
      name: "Assembly specification",
    });
    expect(specification.textContent).toContain("SKU 601R1_001");
    expect(specification.textContent).toContain("SKU JIC_END_A");
    expect(specification.textContent).toContain("SKU ORFS_END_B");
    expect(specification.textContent).toContain("72 in");
    expect(specification.textContent).toContain("Nylon Protective Sleeving");
    expect(specification.textContent).toContain(
      "Finished length requires feasibility review.",
    );
    expect(specification.textContent).not.toMatch(/cut length|crimp/i);
  });

  it("renders dynamic M08 orientation for a double-elbow assembly", () => {
    const { rerender } = render(
      <LiveAssemblyPreview
        draft={assemblyDraft({
          clockingAngle: 45,
          endAAngle: "45°",
          endBAngle: "90°",
        })}
        issues={[]}
      />,
    );

    expect(
      screen.getByRole("img", { name: /Double-elbow Clocking 045 degrees/ }),
    ).toBeTruthy();
    expect(screen.getByText("045° · ±3°")).toBeTruthy();

    rerender(
      <LiveAssemblyPreview
        draft={assemblyDraft({
          clockingAngle: 135,
          endAAngle: "45°",
          endBAngle: "90°",
        })}
        issues={[]}
      />,
    );
    expect(
      screen.getByRole("img", { name: /Double-elbow Clocking 135 degrees/ }),
    ).toBeTruthy();
    expect(screen.queryAllByText("045° · ±3°")).toHaveLength(0);
    expect(screen.getByText("135° · ±3°")).toBeTruthy();
  });

  it("uses domain angle classification and reacts to length and protection changes", () => {
    const { rerender } = render(
      <LiveAssemblyPreview
        draft={assemblyDraft({
          clockingAngle: 90,
          endAAngle: "30°",
          endBAngle: "60°",
          includeProtection: false,
          lengthValue: "36",
        })}
        issues={[]}
      />,
    );

    const angledDiagram = screen.getByRole("img", {
      name: /End A JIC_END_A, angled.*End B ORFS_END_B, angled.*Finished length 36 in.*No protection selected.*Clocking 090°/i,
    });
    expect(angledDiagram.getAttribute("data-end-a-form")).toBe("angled");
    expect(angledDiagram.getAttribute("data-end-b-form")).toBe("angled");

    rerender(
      <LiveAssemblyPreview
        draft={assemblyDraft({
          clockingAngle: 90,
          endAAngle: "30°",
          endBAngle: "60°",
          lengthValue: "84",
        })}
        issues={[]}
      />,
    );
    expect(
      screen.getByRole("img", {
        name: /Finished length 84 in.*Protection Nylon Protective Sleeving/i,
      }),
    ).toBeTruthy();
  });
});
