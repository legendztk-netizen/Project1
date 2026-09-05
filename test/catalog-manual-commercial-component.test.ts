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

function salesValues(sku: string, productType: "Adapter" | "Quick Coupler") {
  return {
    baseSku: sku,
    catalogPublicationStatus: "Published",
    countryOfOrigin: "China",
    currency: "USD",
    leadTimeDays: 10,
    moq: 1,
    productType,
    quantityInputMode: "Units",
    referencePriceUsd: 12.5,
    rfqEligibility: "Eligible",
    salesSku: sku,
    salesUnit: "each",
    technicalDataStatus: "Complete",
    unitsPerSalesPack: 1,
  };
}

function validSubmission(
  productType: Extract<ManualComponentType, "adapter" | "quick_coupler">,
): ManualComponentSubmission {
  if (productType === "adapter") {
    const sku = "ADP_ST_JIC_M_10_NPT_M_04";
    return {
      mainImageReference:
        "catalog-source:https://www.discounthydraulichose.com/2404-jic-37-male-x-nptf-male-pipe.html:adapter:straight",
      masterValues: {
        adapterFamilyId: "ADP-ST-JIC-NPT",
        adapterSku: sku,
        catalogModel: "2404",
        catalogPublicationStatus: "Published",
        connectionForm1: "M",
        connectionForm2: "M",
        interface1: "JIC",
        interface2: "NPT",
        rfqEligibility: "Eligible",
        shapeCode: "ST",
        size1: "-10",
        size2: "-4",
        skuTemplate: "ADP_ST_JIC_M_{SIZE1}_NPT_M_{SIZE2}",
        source: "Manual Adapter test",
        technicalDataStatus: "Complete",
        websiteDisplay: "Straight JIC to NPT adapter",
        websiteProductName: "Straight JIC to NPT Adapter",
      },
      mode: "create",
      originalSalesSku: null,
      originalSku: null,
      productType,
      salesValues: salesValues(sku, "Adapter"),
    };
  }

  const sku = "QDC_16028_SOC_04_FNPT_04";
  return {
    mainImageReference: "catalog-source:62d65f8412ff5.pdf:quick-coupler:p52",
    masterValues: {
      bodyMaterial: "Carbon steel",
      bodySize: "1/4 in",
      catalogPublicationStatus: "Published",
      connectionMechanism: "Push-to-connect",
      couplerSeries: "FEM",
      interchangeStandard: "ISO 16028",
      matingSeries: "FEM",
      maxWorkingBar: 350,
      portGender: "Female",
      portInterface: "NPTF",
      portThread: "1/4-18 NPTF",
      rfqEligibility: "Eligible",
      role: "Coupler/Socket",
      sku,
      source: "Manual Quick Coupler test",
      technicalDataStatus: "Complete",
      valving: "Flat face",
    },
    mode: "create",
    originalSalesSku: null,
    originalSku: null,
    productType,
    salesValues: salesValues(sku, "Quick Coupler"),
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

describe("manual Adapter and Quick Coupler maintenance", () => {
  it.each(["adapter", "quick_coupler"] as const)(
    "creates one complete %s product with price and reviewed image",
    async (productType) => {
      const { repository, writes } = repositoryDouble(null);
      const result = await maintainManualComponent(repository, {
        actorId: "owner-1",
        ...validSubmission(productType),
      });

      expect(result).toMatchObject({ mode: "created", productType });
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        mainImageReference: expect.any(String),
        productType,
        salesOffer: { currency: "USD", referencePriceUsd: 12.5 },
      });
    },
  );

  it.each([
    ["adapter", "price", { referencePriceUsd: 15 }, {}],
    ["adapter", "ordinary", {}, { websiteDisplay: "Updated display" }],
    [
      "adapter",
      "derivation",
      {},
      { connectionForm3: "M", interface3: "ORB", size3: "-4" },
    ],
    ["quick_coupler", "price", { referencePriceUsd: 18 }, {}],
    ["quick_coupler", "ordinary", {}, { bodyMaterial: "Stainless steel" }],
    ["quick_coupler", "derivation", {}, { matingSeries: "FEM-REV-B" }],
  ] as const)(
    "supports a %s %s edit",
    async (productType, _editKind, salesPatch, masterPatch) => {
      const submission = validSubmission(productType);
      const sku = String(
        productType === "adapter"
          ? submission.masterValues.adapterSku
          : submission.masterValues.sku,
      );
      submission.mode = "edit";
      submission.originalSku = sku;
      submission.originalSalesSku = sku;
      Object.assign(submission.salesValues, salesPatch);
      Object.assign(submission.masterValues, masterPatch);
      const { repository, writes } = repositoryDouble({ productType, sku });

      await maintainManualComponent(repository, {
        actorId: "owner-1",
        ...submission,
      });

      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({ mode: "edit", productType });
    },
  );

  it.each(["adapter", "quick_coupler"] as const)(
    "rejects %s when price or image is missing and audits the failure",
    async (productType) => {
      const submission = validSubmission(productType);
      submission.mainImageReference = "";
      submission.salesValues.referencePriceUsd = null;
      const { rejections, repository, writes } = repositoryDouble(null);

      await expect(
        maintainManualComponent(repository, {
          actorId: "owner-1",
          ...submission,
        }),
      ).rejects.toThrow("validation errors");
      expect(writes).toHaveLength(0);
      expect(rejections[0]?.findingCodes).toEqual(
        expect.arrayContaining([
          "main_image_required",
          "reference_price_required",
        ]),
      );
    },
  );

  it("applies the workbook SKU convention to both product types", async () => {
    for (const productType of ["adapter", "quick_coupler"] as const) {
      const submission = validSubmission(productType);
      if (productType === "adapter") {
        submission.masterValues.adapterSku = "BAD-ADAPTER";
        submission.salesValues.baseSku = "BAD-ADAPTER";
        submission.salesValues.salesSku = "BAD-ADAPTER";
      } else {
        submission.masterValues.sku = "BAD-COUPLER";
        submission.salesValues.baseSku = "BAD-COUPLER";
        submission.salesValues.salesSku = "BAD-COUPLER";
      }
      const { rejections, repository } = repositoryDouble(null);
      await expect(
        maintainManualComponent(repository, {
          actorId: "owner-1",
          ...submission,
        }),
      ).rejects.toThrow("validation error");
      expect(rejections[0]?.findingCodes).toContain(
        productType === "adapter"
          ? "invalid_adapter_sku"
          : "invalid_quick_coupler_sku",
      );
    }
  });

  it("preserves the worksheet 07 Quick Plug type for a Plug/Nipple", async () => {
    const submission = validSubmission("quick_coupler");
    const sku = "QDC_16028_PLG_04_FNPT_04";
    submission.masterValues.role = "Plug/Nipple";
    submission.masterValues.sku = sku;
    submission.salesValues = salesValues(sku, "Quick Coupler");
    submission.salesValues.productType = "Quick Plug";
    const { repository, writes } = repositoryDouble(null);

    await maintainManualComponent(repository, {
      actorId: "owner-1",
      ...submission,
    });

    expect(writes[0]?.salesOffer.productType).toBe("Quick Plug");
  });

  it.each(["adapter", "quick_coupler"] as const)(
    "keeps an existing %s SKU and Sales SKU immutable",
    async (productType) => {
      const submission = validSubmission(productType);
      const sku = String(
        productType === "adapter"
          ? submission.masterValues.adapterSku
          : submission.masterValues.sku,
      );
      submission.mode = "edit";
      submission.originalSku = "DIFFERENT-SKU";
      submission.originalSalesSku = "DIFFERENT-SALES-SKU";
      const { rejections, repository, writes } = repositoryDouble({
        productType,
        sku,
      });

      await expect(
        maintainManualComponent(repository, {
          actorId: "owner-1",
          ...submission,
        }),
      ).rejects.toThrow("validation errors");
      expect(writes).toHaveLength(0);
      expect(rejections[0]?.findingCodes).toEqual(
        expect.arrayContaining([
          "published_sales_sku_immutable",
          "published_sku_immutable",
        ]),
      );
    },
  );

  it("rejects duplicate and wrong-type identifiers before writing", async () => {
    const adapter = validSubmission("adapter");
    const adapterSku = String(adapter.masterValues.adapterSku);
    const duplicate = repositoryDouble({
      productType: "adapter",
      sku: adapterSku,
    });
    await expect(
      maintainManualComponent(duplicate.repository, {
        actorId: "owner-1",
        ...adapter,
      }),
    ).rejects.toThrow("already exists");

    const quickCoupler = validSubmission("quick_coupler");
    const quickSku = String(quickCoupler.masterValues.sku);
    quickCoupler.mode = "edit";
    quickCoupler.originalSku = quickSku;
    quickCoupler.originalSalesSku = quickSku;
    const wrongType = repositoryDouble({
      productType: "adapter",
      sku: quickSku,
    });
    await expect(
      maintainManualComponent(wrongType.repository, {
        actorId: "owner-1",
        ...quickCoupler,
      }),
    ).rejects.toThrow("was not found");
    expect(duplicate.writes).toHaveLength(0);
    expect(wrongType.writes).toHaveLength(0);
  });
});
