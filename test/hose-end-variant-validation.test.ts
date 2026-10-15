import { describe, expect, it } from "vitest";
import { validateHoseEndVariantMaintenance } from "../app/modules/catalog/domain/catalog-hose-end-maintenance";

const repository = {
  findHoseEndSeries: async (code: string) => ({ seriesCode: code }) as never,
  findProductIdentity: async (sku: string) => ({
    sku,
    productType: "hose_end" as const,
  }),
};
const legacyVariant = {
  sku: "JIC45_F_SW_06_04",
  fittingSeries: "FJX45 competitor matrix",
  competitorPartNumber: "FJX45-06-04",
  connectionDash: "-4",
  hoseTailDash: "-6",
  thread: "7/16-20 UNF",
  material: "",
  coating: "",
  saltSprayHours: "",
  maxWorkingBar: "",
  dimensionAMm: "",
  cutoffBMm: "",
  hex1Mm: "",
  hex2Mm: "",
  minimumBoreMm: "",
  unitWeightG: "",
  drawingNumber: "",
  drawingRevision: "",
  source: "Competitor matrix",
  notes: "",
  technicalDataStatus: "Pending",
};

describe("hose end variant validation", () => {
  it("accepts blank technical data saved as empty strings and stores it as null", async () => {
    const { variant } = await validateHoseEndVariantMaintenance(repository, {
      actorId: "owner",
      mode: "edit",
      originalSku: legacyVariant.sku,
      lifecycleStatus: "discontinued",
      imageOverrideReference: null,
      variant: legacyVariant as never,
    });
    expect(variant).toMatchObject({
      material: null,
      coating: null,
      saltSprayHours: null,
      maxWorkingBar: null,
      unitWeightG: null,
    });
  });

  it("still rejects a technical value that is not a number", async () => {
    await expect(
      validateHoseEndVariantMaintenance(repository, {
        actorId: "owner",
        mode: "edit",
        originalSku: legacyVariant.sku,
        lifecycleStatus: "online",
        imageOverrideReference: null,
        variant: { ...legacyVariant, maxWorkingBar: "high" } as never,
      }),
    ).rejects.toMatchObject({
      findings: [expect.objectContaining({ code: "invalid_number" })],
    });
  });
});
