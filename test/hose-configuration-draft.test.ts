import { describe, expect, it } from "vitest";

import type { PublicCatalogItem } from "../app/modules/catalog/domain/public-catalog";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";

function hose(overrides: Partial<PublicCatalogItem> = {}): PublicCatalogItem {
  return {
    aliases: ["SAE 100 R1AT"],
    canAddToQuote: true,
    category: "hydraulic-hose",
    displayName: "601R1 Hydraulic Hose -3",
    familyKey: "601r1",
    familyName: "601R1 Hydraulic Hose",
    interfaceGroup: null,
    mediaKey: "601R1",
    offer: {
      currency: "USD",
      leadTimeDays: 10,
      lengthOrdering: null,
      madeToOrder: false,
      moq: 1,
      referencePrice: 1.25,
      salesUnit: "ft",
    },
    productType: "hose",
    releaseId: "release-002",
    releaseNumber: "CAT-002",
    rfqEligibility: "Eligible",
    sku: "601R1_001",
    specs: [],
    supplyAvailability: "available_for_quote",
    variantSelection: {
      dash: "-3",
      equivalentStandard: "EN 853 1SN",
      hoseSeries: "601R1",
      kind: "hose",
      nominalIdIn: 0.1875,
      performance: {
        temperatureMaxC: 100,
        temperatureMinC: -40,
        workingBar: 250,
        workingPsi: 3630,
      },
      primaryStandard: "SAE 100 R1AT",
      reinforcement: "Single wire braid",
    },
    ...overrides,
  };
}

describe("page-session hose configuration draft", () => {
  it("snapshots the exact catalog release, hose SKU, performance, and presentation", () => {
    expect(createHoseConfigurationDraft(hose())).toEqual({
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
          workingPsi: 3630,
        },
        primaryStandard: "SAE 100 R1AT",
        reinforcement: "Single wire braid",
        series: "601R1",
        sku: "601R1_001",
      },
    });
  });

  it("does not create a draft from an unavailable or non-hose product", () => {
    expect(createHoseConfigurationDraft(hose({ canAddToQuote: false }))).toBe(
      null,
    );
    expect(
      createHoseConfigurationDraft(
        hose({ productType: "adapter", variantSelection: null }),
      ),
    ).toBe(null);
  });

  it("replaces the exact hose snapshot when the page-session selection changes", () => {
    const nextSelection = hose().variantSelection;
    if (nextSelection?.kind !== "hose") throw new Error("Expected hose data");
    const first = createHoseConfigurationDraft(hose());
    const second = createHoseConfigurationDraft(
      hose({
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
