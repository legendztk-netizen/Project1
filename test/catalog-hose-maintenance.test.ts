import { describe, expect, it } from "vitest";

import {
  maintainHoseSeries,
  maintainHoseVariant,
  type CatalogHoseMaintenanceRepository,
  type HoseSeriesRecord,
  type SaveHoseSeriesOperation,
  type SaveHoseVariantOperation,
} from "../app/modules/catalog/domain/catalog-hose-maintenance";

const series: HoseSeriesRecord = {
  coverColor: "Black",
  coverFinish: "Wrapped",
  coverMaterial: "Synthetic rubber",
  equivalentStandard: "EN 853 1SN",
  fluidCompatibility: "Hydraulic oil",
  primaryStandard: "SAE 100 R1AT",
  reinforcement: "One wire braid",
  representativeImageReference: "hose-series:601R1",
  seriesCode: "601R1",
  seriesName: "601R1 One-wire Hose",
  tempMaxC: 100,
  tempMinC: -40,
  tubeMaterial: "Oil-resistant synthetic rubber",
};

function repositoryDouble(seriesExists = true) {
  const seriesWrites: SaveHoseSeriesOperation[] = [];
  const variantWrites: SaveHoseVariantOperation[] = [];
  const repository: CatalogHoseMaintenanceRepository = {
    async findHoseSeries(code) {
      return seriesExists && code === series.seriesCode ? series : null;
    },
    async findHoseVariant() {
      return null;
    },
    async findProductIdentity() {
      return null;
    },
    async listHoseSeries() {
      return [series];
    },
    async saveHoseSeries(operation) {
      seriesWrites.push(operation);
      return {
        draftReleaseId: operation.draftReleaseId,
        mode: operation.mode === "create" ? "created" : "updated",
        seriesCode: operation.series.seriesCode,
      };
    },
    async saveHoseVariant(operation) {
      variantWrites.push(operation);
      return {
        draftReleaseId: operation.draftReleaseId,
        mode: operation.mode === "create" ? "created" : "updated",
        sku: operation.variant.sku,
      };
    },
  };
  return { repository, seriesWrites, variantWrites };
}

describe("bilingual Hose series and variant maintenance", () => {
  it("builds one versioned series command with the confirmed field ownership", async () => {
    const { repository, seriesWrites } = repositoryDouble(false);
    await maintainHoseSeries(repository, {
      actorId: "owner-1",
      generateId: () => "generated-id",
      mode: "create",
      originalSeriesCode: null,
      series,
    });

    expect(seriesWrites).toHaveLength(1);
    expect(seriesWrites[0]?.series).toEqual(series);
  });

  it("rejects an incomplete series and an attempted code rename before writing", async () => {
    const incomplete = repositoryDouble();
    await expect(
      maintainHoseSeries(incomplete.repository, {
        actorId: "owner-1",
        mode: "create",
        originalSeriesCode: null,
        series: { ...series, seriesName: "", tempMinC: Number.NaN },
      }),
    ).rejects.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ field: "Series Name / 系列名称" }),
        expect.objectContaining({ field: "Temp Min °C / 最低温度" }),
      ]),
    });
    expect(incomplete.seriesWrites).toHaveLength(0);

    const renamed = repositoryDouble();
    await expect(
      maintainHoseSeries(renamed.repository, {
        actorId: "owner-1",
        mode: "edit",
        originalSeriesCode: "OLD-CODE",
        series,
      }),
    ).rejects.toThrow("Series Code cannot be changed / 系列编号不可修改");
    expect(renamed.seriesWrites).toHaveLength(0);
  });

  it("saves a variant with only variant-owned input and inherited series data", async () => {
    const { repository, variantWrites } = repositoryDouble();
    await maintainHoseVariant(repository, {
      actorId: "owner-1",
      imageOverrideReference: null,
      lifecycleStatus: "online",
      mode: "create",
      originalSku: null,
      variant: {
        bendRadiusMm: 100,
        burstBar: 720,
        dash: "-4",
        hoseSeries: "601R1",
        idMm: 6.4,
        mshaMarking: null,
        nominalIdIn: 0.25,
        notes: "Launch size",
        odMm: 13.4,
        skiveRequirement: null,
        sku: "601R1_TEST_04",
        source: null,
        technicalDataStatus: null,
        weightKgM: 0.2,
        workingBar: 180,
        workingPsi: 2610,
      },
    });

    expect(variantWrites).toHaveLength(1);
    expect(variantWrites[0]).toMatchObject({
      imageOverrideReference: null,
      lifecycle: {
        catalogPublicationStatus: "Published",
        rfqEligibility: "Eligible",
        supplyAvailability: "available_for_quote",
      },
      series,
      variant: { hoseSeries: "601R1", sku: "601R1_TEST_04" },
    });
    expect(variantWrites[0]).not.toHaveProperty("salesOffer");
  });

  it("rejects a missing series and incomplete variant without partial writes", async () => {
    const missing = repositoryDouble();
    await expect(
      maintainHoseVariant(missing.repository, {
        actorId: "owner-1",
        imageOverrideReference: null,
        lifecycleStatus: "draft",
        mode: "create",
        originalSku: null,
        variant: {
          bendRadiusMm: 0,
          burstBar: 0,
          dash: "",
          hoseSeries: "UNKNOWN",
          idMm: 0,
          mshaMarking: null,
          nominalIdIn: 0,
          notes: "",
          odMm: 0,
          skiveRequirement: null,
          sku: "",
          source: null,
          technicalDataStatus: null,
          weightKgM: 0,
          workingBar: 0,
          workingPsi: 0,
        },
      }),
    ).rejects.toMatchObject({ findings: expect.any(Array) });
    expect(missing.variantWrites).toHaveLength(0);
  });
});
