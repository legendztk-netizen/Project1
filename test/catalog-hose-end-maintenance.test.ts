import { describe, expect, it } from "vitest";

import {
  maintainHoseEndSeries,
  maintainHoseEndVariant,
  type CatalogHoseEndMaintenanceRepository,
  type HoseEndSeriesRecord,
  type SaveHoseEndSeriesOperation,
  type SaveHoseEndVariantOperation,
} from "../app/modules/catalog/domain/catalog-hose-end-maintenance";

const series: HoseEndSeriesRecord = {
  angle: "0° Straight",
  gender: "Female",
  interfaceFamily: "JIC 37°",
  interfaceStandard: "SAE J514",
  representativeImageReference:
    "hose-end-shape:JIC 37°-Female-Swivel-0° Straight",
  sealingForm: "37° flare",
  seriesCode: "FJX",
  seriesName: "JIC Female Swivel",
  swivelForm: "Swivel",
};

const variant = {
  coating: "Zinc nickel",
  competitorPartNumber: null,
  connectionDash: "-04",
  cutoffBMm: 18,
  dimensionAMm: 45,
  drawingNumber: null,
  drawingRevision: null,
  fittingSeries: "FJX",
  hex1Mm: 14,
  hex2Mm: 17,
  hoseTailDash: "-04",
  material: "Carbon steel",
  maxWorkingBar: 350,
  minimumBoreMm: 5,
  notes: "Launch size",
  saltSprayHours: 720,
  sku: "FJX-04-04",
  source: null,
  technicalDataStatus: null,
  thread: "7/16-20 UNF",
  unitWeightG: 82,
};

function repositoryDouble(seriesExists = true) {
  const seriesWrites: SaveHoseEndSeriesOperation[] = [];
  const variantWrites: SaveHoseEndVariantOperation[] = [];
  const repository: CatalogHoseEndMaintenanceRepository = {
    async findHoseEndSeries(code) {
      return seriesExists && code === series.seriesCode ? series : null;
    },
    async findHoseEndVariant() {
      return null;
    },
    async findProductIdentity() {
      return null;
    },
    async listHoseEndSeries() {
      return [series];
    },
    async saveHoseEndSeries(operation) {
      seriesWrites.push(operation);
      return {
        draftReleaseId: operation.draftReleaseId,
        mode: operation.mode === "create" ? "created" : "updated",
        seriesCode: operation.series.seriesCode,
      };
    },
    async saveHoseEndVariant(operation) {
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

describe("bilingual Hose End series and variant maintenance", () => {
  it("saves the confirmed series fields and keeps Series Code immutable", async () => {
    const created = repositoryDouble(false);
    await maintainHoseEndSeries(created.repository, {
      actorId: "owner-1",
      generateId: () => "generated-id",
      mode: "create",
      originalSeriesCode: null,
      series,
    });
    expect(created.seriesWrites[0]?.series).toEqual(series);

    const edited = repositoryDouble();
    await expect(
      maintainHoseEndSeries(edited.repository, {
        actorId: "owner-1",
        mode: "edit",
        originalSeriesCode: "OLD",
        series,
      }),
    ).rejects.toThrow("Series Code cannot be changed / 系列编号不可修改");
    expect(edited.seriesWrites).toHaveLength(0);
  });

  it("saves only variant-owned fields and synchronizes Online lifecycle state", async () => {
    const { repository, variantWrites } = repositoryDouble();
    await maintainHoseEndVariant(repository, {
      actorId: "owner-1",
      imageOverrideReference: null,
      lifecycleStatus: "online",
      mode: "create",
      originalSku: null,
      variant,
    });

    expect(variantWrites[0]).toMatchObject({
      imageOverrideReference: null,
      lifecycle: {
        catalogPublicationStatus: "Published",
        rfqEligibility: "Eligible",
        supplyAvailability: "available_for_quote",
      },
      series,
      variant,
    });
    expect(variantWrites[0]).not.toHaveProperty("salesOffer");
    expect(variantWrites[0]?.variant).not.toHaveProperty("interfaceFamily");
  });

  it("rejects incomplete data and an unknown series before any write", async () => {
    const incomplete = repositoryDouble();
    await expect(
      maintainHoseEndVariant(incomplete.repository, {
        actorId: "owner-1",
        imageOverrideReference: null,
        lifecycleStatus: "draft",
        mode: "create",
        originalSku: null,
        variant: { ...variant, fittingSeries: "UNKNOWN", thread: "" },
      }),
    ).rejects.toMatchObject({ findings: expect.any(Array) });
    expect(incomplete.variantWrites).toHaveLength(0);
  });
});
