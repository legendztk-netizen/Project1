import type { PublicCatalogItem } from "../../app/modules/catalog/domain/public-catalog";

export function publicHoseFixture(
  overrides: Partial<PublicCatalogItem> = {},
): PublicCatalogItem {
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
        workingPsi: 3626,
      },
      primaryStandard: "SAE 100 R1AT",
      reinforcement: "Single wire braid",
    },
    ...overrides,
  };
}
