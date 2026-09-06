import { describe, expect, it } from "vitest";

import {
  maintainSeriesCommercialRule,
  maintainSkuPricePackaging,
  resolveEffectiveCommercialData,
  type CatalogCommercialMaintenanceRepository,
  type SeriesCommercialRule,
  type SkuPricePackaging,
} from "../app/modules/catalog/domain/catalog-commercial-maintenance";

const rule: SeriesCommercialRule = {
  continuousLengthConfirmation: "Required",
  countryOfOrigin: "China",
  hsCode: "4009.21",
  leadTimeDays: 14,
  lengthIncrementFt: 1,
  minimumLengthPerPieceFt: 3,
  moq: 1,
  notes: null,
  presetLength1Ft: 10,
  presetLength2Ft: 25,
  presetLength3Ft: 50,
  productType: "hose",
  quantityInputMode: "length",
  salesUnit: "ft",
  seriesCode: "601R1",
};

const exact: SkuPricePackaging = {
  cartonGrossWeightKg: null,
  cartonHCm: null,
  cartonLCm: null,
  cartonWCm: null,
  currency: "USD",
  innerPackQty: null,
  masterCartonQty: null,
  netUnitWeightKg: null,
  packageLengthFt: null,
  packingBasis: null,
  referencePrice: 2.16,
  salesSku: "601R1_001",
  sku: "601R1_001",
  unitsPerSalesPack: null,
};

function repositoryStub() {
  const savedRules: unknown[] = [];
  const savedExact: unknown[] = [];
  const repository: CatalogCommercialMaintenanceRepository = {
    findSeries: async () => ({
      productType: "hose",
      seriesCode: "601R1",
      seriesName: "601R1",
    }),
    findSeriesRule: async () => rule,
    findSku: async () => ({
      lifecycleStatus: "online",
      productType: "hose",
      seriesCode: "601R1",
      sku: "601R1_001",
    }),
    findSkuPricePackaging: async () => null,
    listSeries: async () => [],
    saveSeriesRule: async (operation) => {
      savedRules.push(operation);
      return { draftReleaseId: operation.draftReleaseId };
    },
    saveSkuPricePackaging: async (operation) => {
      savedExact.push(operation);
      return { draftReleaseId: operation.draftReleaseId };
    },
  };
  return { repository, savedExact, savedRules };
}

describe("Catalog commercial maintenance", () => {
  it("keeps one live series rule separate from exact-SKU price and packaging", () => {
    const before = resolveEffectiveCommercialData(rule, exact);
    const after = resolveEffectiveCommercialData(
      { ...rule, leadTimeDays: 7, moq: 5 },
      exact,
    );

    expect(before).toMatchObject({
      leadTimeDays: 14,
      moq: 1,
      referencePrice: 2.16,
      sku: "601R1_001",
    });
    expect(after).toMatchObject({
      leadTimeDays: 7,
      moq: 5,
      referencePrice: 2.16,
      sku: "601R1_001",
    });
    expect(exact).toEqual(expect.objectContaining({ referencePrice: 2.16 }));
  });

  it("generates Sales SKU from product SKU and fixes currency to USD", async () => {
    const { repository, savedExact } = repositoryStub();
    await maintainSkuPricePackaging(repository, {
      actorId: "owner-1",
      generateId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-05T04:00:00.000Z"),
      packaging: { ...exact, currency: "USD", salesSku: "ignored" },
      sku: " 601r1_001 ",
    });

    expect(savedExact).toHaveLength(1);
    expect(savedExact[0]).toMatchObject({
      packaging: {
        currency: "USD",
        salesSku: "601R1_001",
        sku: "601R1_001",
      },
    });
  });

  it("allows optional packaging but rejects non-USD or invalid prices bilingually", async () => {
    const { repository } = repositoryStub();
    await expect(
      maintainSkuPricePackaging(repository, {
        actorId: "owner-1",
        packaging: {
          ...exact,
          currency: "EUR" as "USD",
          referencePrice: -1,
        },
        sku: exact.sku,
      }),
    ).rejects.toThrow(/USD.*美元|美元.*USD/u);
  });

  it("audits a valid shared rule mutation against the selected series", async () => {
    const { repository, savedRules } = repositoryStub();
    await maintainSeriesCommercialRule(repository, {
      actorId: "owner-1",
      generateId: () => crypto.randomUUID(),
      now: () => new Date("2026-09-05T04:00:00.000Z"),
      rule,
    });
    expect(savedRules).toHaveLength(1);
    expect(savedRules[0]).toMatchObject({
      actorId: "owner-1",
      rule: { productType: "hose", seriesCode: "601R1" },
    });
  });

  it("preserves the catalog's canonical series code across product types", async () => {
    const { repository, savedRules } = repositoryStub();
    repository.findSeries = async () => ({
      productType: "ferrule",
      seriesCode: "Series 2000",
      seriesName: "Series 2000",
    });
    await maintainSeriesCommercialRule(repository, {
      actorId: "owner-1",
      rule: {
        ...rule,
        productType: "ferrule",
        seriesCode: "series 2000",
      },
    });
    expect(savedRules[0]).toMatchObject({
      rule: { productType: "ferrule", seriesCode: "Series 2000" },
    });
  });
});
