import { describe, expect, it } from "vitest";

import {
  maintainManualComponent,
  type AuditManualComponentRejection,
  type CatalogManualComponentRepository,
  type ManualComponentSubmission,
  type ManualComponentType,
  type SaveManualComponentOperation,
} from "../app/modules/catalog/domain/catalog-manual-component";
import type { ManualCatalogProductIdentity } from "../app/modules/catalog/domain/catalog-manual-hose";

function salesValues(sku: string, productType: "Ferrule" | "Hose End") {
  return {
    baseSku: sku,
    catalogPublicationStatus: "Published",
    cartonGrossWeightKg: null,
    cartonHCm: null,
    cartonLCm: null,
    cartonWCm: null,
    continuousLengthConfirmation: null,
    countryOfOrigin: "China",
    currency: "USD",
    factoryUnitPrice: null,
    hsCode: null,
    incotermPlace: null,
    innerPackQty: 10,
    leadTimeDays: 14,
    lengthIncrementFt: null,
    masterCartonQty: 100,
    minimumLengthPerPieceFt: null,
    moq: 1,
    netUnitWeightKg: 0.12,
    notes: null,
    packageLengthFt: null,
    packingBasis: "Carton",
    presetLength1Ft: null,
    presetLength2Ft: null,
    presetLength3Ft: null,
    priceIncoterm: null,
    productType,
    quantityInputMode: "Units",
    referencePriceUsd: 4.25,
    rfqEligibility: "Eligible",
    salesSku: sku,
    salesUnit: "each",
    technicalDataStatus: "Complete",
    tierPrice: null,
    tierQty: null,
    unitsPerSalesPack: 1,
  };
}

function validSubmission(
  productType: ManualComponentType,
): ManualComponentSubmission {
  if (productType === "hose_end") {
    const sku = "JIC_F_SW_04_04_TEST";
    return {
      mainImageReference: "hose-end-shape:JIC 37°-Female-Swivel-0° Straight",
      masterValues: {
        angle: "0° Straight",
        catalogPublicationStatus: "Published",
        coating: "Zinc plating",
        competitorPartNumber: "TEST-04",
        connectionDash: "-4",
        connectionStandard: "SAE J514",
        cutoffBMm: 22,
        dimensionAMm: 55,
        drawingNumber: "TEST-DWG",
        drawingRevision: "A",
        fittingSeries: "JIC test",
        gender: "Female",
        hex1Mm: 17,
        hex2Mm: 19,
        hoseTailDash: "-4",
        interfaceFamily: "JIC 37°",
        material: "Carbon steel",
        maxWorkingBar: 350,
        minimumBoreMm: 4.5,
        notes: null,
        rfqEligibility: "Eligible",
        saltSprayHours: 96,
        sealingForm: "37° cone",
        sku,
        source: "Manual Hose End test",
        swivelForm: "Swivel",
        technicalDataStatus: "Complete",
        thread: "7/16-20 UNF",
        unitWeightG: 85,
      },
      mode: "create",
      originalSalesSku: null,
      originalSku: null,
      productType,
      salesValues: salesValues(sku, "Hose End"),
    };
  }

  const sku = "601R1_1WB_TEST";
  return {
    mainImageReference: "catalog-source:62d65f8412ff5.pdf:ferrule:p49-50",
    masterValues: {
      catalogPublicationStatus: "Published",
      coating: "Zinc plating",
      ferruleSeries: "601R1",
      hoseConstruction: "1-wire braid",
      hoseTailDash: "-4",
      material: "Carbon steel",
      notes: null,
      rfqEligibility: "Eligible",
      skiveRequirement: "Other",
      sku,
      source: "Manual Ferrule test",
      technicalDataStatus: "Complete",
    },
    mode: "create",
    originalSalesSku: null,
    originalSku: null,
    productType,
    salesValues: salesValues(sku, "Ferrule"),
  };
}

function repositoryDouble(identity: ManualCatalogProductIdentity | null) {
  const rejections: AuditManualComponentRejection[] = [];
  const writes: SaveManualComponentOperation[] = [];
  const repository: CatalogManualComponentRepository = {
    async auditManualComponentRejection(rejection) {
      rejections.push(rejection);
    },
    async findComponentByExactSku() {
      return null;
    },
    async findProductIdentity() {
      return identity;
    },
    async saveManualComponent(operation) {
      writes.push(operation);
      return {
        draftReleaseId: operation.draftReleaseId,
        draftReleaseNumber: operation.draftReleaseNumber,
        mode: operation.mode === "create" ? "created" : "updated",
        productType: operation.productType,
        sku: operation.master.sku,
      };
    },
  };
  return { rejections, repository, writes };
}

describe("manual Hose End and Ferrule maintenance", () => {
  it.each(["hose_end", "ferrule"] as const)(
    "creates one complete %s product, price, and reviewed image reference",
    async (productType) => {
      const { repository, writes } = repositoryDouble(null);
      const result = await maintainManualComponent(repository, {
        actorId: "owner-1",
        generateId: () => crypto.randomUUID(),
        now: () => new Date("2026-09-04T08:00:00.000Z"),
        ...validSubmission(productType),
      });

      expect(result).toMatchObject({ mode: "created", productType });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        actorId: "owner-1",
        mainImageReference: expect.any(String),
        productType,
        salesOffer: { currency: "USD", referencePriceUsd: 4.25 },
      });
    },
  );

  it.each([
    ["hose_end", "price", { referencePriceUsd: 5.5 }, {}],
    ["hose_end", "ordinary", {}, { coating: "Zinc Nickel" }],
    ["hose_end", "derivation", {}, { hoseTailDash: "-6" }],
    ["ferrule", "price", { referencePriceUsd: 3.5 }, {}],
    ["ferrule", "ordinary", {}, { coating: "Zinc Nickel" }],
    ["ferrule", "derivation", {}, { hoseTailDash: "-6" }],
  ] as const)(
    "accepts a %s %s-only edit",
    async (productType, _editType, salesChanges, masterChanges) => {
      const submission = validSubmission(productType);
      submission.mode = "edit";
      submission.originalSku = String(submission.masterValues.sku);
      submission.originalSalesSku = String(submission.salesValues.salesSku);
      Object.assign(submission.masterValues, masterChanges);
      Object.assign(submission.salesValues, salesChanges);
      const { repository, writes } = repositoryDouble({
        productType,
        sku: String(submission.masterValues.sku),
      });

      await maintainManualComponent(repository, {
        actorId: "owner-1",
        ...submission,
      });

      expect(writes).toHaveLength(1);
      expect(writes[0]?.mode).toBe("edit");
    },
  );

  it.each(["hose_end", "ferrule"] as const)(
    "rejects incomplete %s input and audits the failed attempt",
    async (productType) => {
      const submission = validSubmission(productType);
      submission.salesValues.referencePriceUsd = null;
      submission.mainImageReference = "";
      const { rejections, repository, writes } = repositoryDouble(null);

      await expect(
        maintainManualComponent(repository, {
          actorId: "owner-1",
          ...submission,
        }),
      ).rejects.toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({ code: "reference_price_required" }),
          expect.objectContaining({ code: "main_image_required" }),
        ]),
      });
      expect(writes).toHaveLength(0);
      expect(rejections).toEqual([
        expect.objectContaining({ actorId: "owner-1", productType }),
      ]);
    },
  );

  it("keeps existing product and Sales SKU identities immutable", async () => {
    const submission = validSubmission("ferrule");
    submission.mode = "edit";
    submission.originalSku = "OLD-FERRULE";
    submission.originalSalesSku = "OLD-FERRULE";
    const { repository, writes } = repositoryDouble({
      productType: "ferrule",
      sku: String(submission.masterValues.sku),
    });

    await expect(
      maintainManualComponent(repository, {
        actorId: "owner-1",
        ...submission,
      }),
    ).rejects.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "published_sku_immutable" }),
        expect.objectContaining({ code: "published_sales_sku_immutable" }),
      ]),
    });
    expect(writes).toHaveLength(0);
  });

  it("rejects a SKU owned by another product type", async () => {
    const submission = validSubmission("hose_end");
    const { rejections, repository, writes } = repositoryDouble({
      productType: "ferrule",
      sku: String(submission.masterValues.sku),
    });

    await expect(
      maintainManualComponent(repository, {
        actorId: "owner-1",
        ...submission,
      }),
    ).rejects.toThrow("already exists");
    expect(writes).toHaveLength(0);
    expect(rejections).toHaveLength(1);
  });
});
