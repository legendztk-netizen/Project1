import { describe, expect, it } from "vitest";

import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import { publicHoseFixture } from "./fixtures/public-hose";

describe("page-session hose configuration draft", () => {
  it("snapshots the exact catalog release, hose SKU, performance, and presentation", () => {
    expect(createHoseConfigurationDraft(publicHoseFixture())).toEqual({
      catalogRelease: { id: "release-002", number: "CAT-002" },
      hose: {
        dash: "-3",
        equivalentStandard: "EN 853 1SN",
        familyKey: "601r1",
        familyName: "601R1 Hydraulic Hose",
        mediaKey: "601R1",
        nominalIdIn: 0.1875,
        performance: {
          temperatureMaxC: 100,
          temperatureMinC: -40,
          workingBar: 250,
          workingPsi: 3626,
        },
        primaryStandard: "SAE 100 R1AT",
        reinforcement: "Single wire braid",
        series: "601R1",
        sku: "601R1_001",
      },
    });
  });

  it("does not create a draft from an unavailable or non-hose product", () => {
    expect(
      createHoseConfigurationDraft(publicHoseFixture({ canAddToQuote: false })),
    ).toBe(null);
    expect(
      createHoseConfigurationDraft(
        publicHoseFixture({ productType: "adapter", variantSelection: null }),
      ),
    ).toBe(null);
  });

  it("replaces the exact hose snapshot when the page-session selection changes", () => {
    const nextSelection = publicHoseFixture().variantSelection;
    if (nextSelection?.kind !== "hose") throw new Error("Expected hose data");
    const first = createHoseConfigurationDraft(publicHoseFixture());
    const second = createHoseConfigurationDraft(
      publicHoseFixture({
        displayName: "601R1 Hydraulic Hose -4",
        sku: "601R1_002",
        variantSelection: {
          ...nextSelection,
          dash: "-4",
          nominalIdIn: 0.25,
          performance: {
            ...nextSelection.performance,
            workingBar: 225,
            workingPsi: 3260,
          },
        },
      }),
    );

    expect(first?.hose.sku).toBe("601R1_001");
    expect(second?.hose).toMatchObject({
      dash: "-4",
      nominalIdIn: 0.25,
      performance: { workingBar: 225, workingPsi: 3260 },
      sku: "601R1_002",
    });
  });
});
