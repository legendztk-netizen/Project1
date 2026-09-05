import { describe, expect, it } from "vitest";

import {
  maintainManualHose,
  type CatalogManualHoseRepository,
  type ManualCatalogProductIdentity,
  type ManualHoseSubmission,
  type SaveManualHoseOperation,
} from "../app/modules/catalog/domain/catalog-manual-hose";

function validSubmission(): ManualHoseSubmission {
  const hoseValues = {
    bendRadiusMm: 100,
    burstBar: 720,
    catalogPublicationStatus: "Published",
    coverColor: "Black",
    coverFinish: "Wrapped",
    coverMaterial: "Synthetic rubber",
    dash: "-4",
    equivalentStandard: "EN 853 1SN",
    fluidCompatibility: "Hydraulic oil",
    hoseSeries: "601R1",
    idMm: 6.4,
    mshaMarking: "N/A",
    nominalIdIn: 0.25,
    notes: null,
    odMm: 13.4,
    origin: "China",
    primaryStandard: "SAE 100R1AT",
    reinforcement: "One wire braid",
    rfqEligibility: "Eligible",
    skiveRequirement: "No Skive",
    sku: "601R1_TEST_04",
    source: "Manual test source",
    technicalDataStatus: "Complete",
    tempMaxC: 100,
    tempMinC: -40,
    tubeMaterial: "Oil-resistant synthetic rubber",
    weightKgM: 0.2,
    workingBar: 180,
    workingPsi: 2610,
  };
  const salesValues = {
    baseSku: "601R1_TEST_04",
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
    innerPackQty: null,
    leadTimeDays: 14,
    lengthIncrementFt: 1,
    masterCartonQty: null,
    minimumLengthPerPieceFt: 1,
    moq: 1,
    netUnitWeightKg: 0.2,
    notes: null,
    packageLengthFt: null,
    packingBasis: null,
    presetLength1Ft: 5,
    presetLength2Ft: 10,
    presetLength3Ft: 20,
    priceIncoterm: null,
    productType: "Hose Variant",
    quantityInputMode: "Length x Pieces",
    referencePriceUsd: 3.25,
    rfqEligibility: "Eligible",
    salesSku: "601R1_TEST_04",
    salesUnit: "ft",
    technicalDataStatus: "Complete",
    tierPrice: null,
    tierQty: null,
    unitsPerSalesPack: 1,
  };
  return {
    hoseValues: { ...hoseValues },
    mainImageReference: "hose-series:601R1",
    mode: "create" as const,
    originalSalesSku: null,
    originalSku: null,
    salesValues: { ...salesValues },
  };
}

function repositoryDouble(identity: ManualCatalogProductIdentity | null) {
  const writes: SaveManualHoseOperation[] = [];
  const repository: CatalogManualHoseRepository = {
    async findHoseByExactSku() {
      return null;
    },
    async findProductIdentity() {
      return identity;
    },
    async saveManualHose(operation) {
      writes.push(operation);
      return {
        draftReleaseId: operation.draftReleaseId,
        draftReleaseNumber: operation.draftReleaseNumber,
        mode: operation.mode === "create" ? "created" : "updated",
        sku: operation.hose.sku,
      };
    },
  };
  return { repository, writes };
}

describe("manual Hose maintenance", () => {
  it("creates one complete Hose and price row only in the pending-version command", async () => {
    const { repository, writes } = repositoryDouble(null);
    const ids = [
      "release-1",
      "import-1",
      "audit-1",
      "cost-1",
      "hose-1",
      "offer-1",
      "sku-1",
    ];

    const result = await maintainManualHose(repository, {
      actorId: "owner-1",
      generateId: () => ids.shift() ?? "unexpected",
      now: () => new Date("2026-09-04T08:00:00.000Z"),
      ...validSubmission(),
    });

    expect(result).toMatchObject({ mode: "created", sku: "601R1_TEST_04" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      actorId: "owner-1",
      hose: { hoseSeries: "601R1", sku: "601R1_TEST_04" },
      mainImageReference: "hose-series:601R1",
      salesOffer: {
        baseSku: "601R1_TEST_04",
        currency: "USD",
        referencePriceUsd: 3.25,
      },
    });
  });

  it.each([
    ["price only", { referencePriceUsd: 4.5 }, {}],
    ["ordinary parameters", {}, { coverColor: "Blue" }],
    ["derivation parameters", {}, { dash: "-6" }],
  ])("accepts an existing-SKU %s edit", async (_name, sales, hose) => {
    const { repository, writes } = repositoryDouble({
      productType: "hose",
      sku: "601R1_TEST_04",
    });
    const submission = validSubmission();
    submission.mode = "edit";
    submission.originalSku = String(submission.hoseValues.sku);
    submission.originalSalesSku = String(submission.salesValues.salesSku);
    Object.assign(submission.hoseValues, hose);
    Object.assign(submission.salesValues, sales);

    await maintainManualHose(repository, {
      actorId: "owner-1",
      ...submission,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.mode).toBe("edit");
    expect(writes[0]?.salesOffer.referencePriceUsd).toBe(
      "referencePriceUsd" in sales ? sales.referencePriceUsd : 3.25,
    );
  });

  it("rejects incomplete input without writing a partial product", async () => {
    const { repository, writes } = repositoryDouble(null);
    const submission = validSubmission();
    submission.salesValues.referencePriceUsd = null;
    submission.hoseValues.source = "";

    await expect(
      maintainManualHose(repository, {
        actorId: "owner-1",
        ...submission,
      }),
    ).rejects.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: "required",
          field: "Source Document/Page / 来源文件页码",
        }),
        expect.objectContaining({ code: "reference_price_required" }),
      ]),
    });
    expect(writes).toHaveLength(0);
  });

  it("keeps published product and Sales SKU identities immutable", async () => {
    const { repository, writes } = repositoryDouble({
      productType: "hose",
      sku: "601R1_RENAMED",
    });
    const submission = validSubmission();
    submission.mode = "edit";
    submission.originalSku = "601R1_TEST_04";
    submission.originalSalesSku = "601R1_TEST_04";
    submission.hoseValues.sku = "601R1_RENAMED";
    submission.salesValues.baseSku = "601R1_RENAMED";
    submission.salesValues.salesSku = "601R1_RENAMED";

    await expect(
      maintainManualHose(repository, {
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

  it("rejects a duplicate SKU and an image from another series", async () => {
    const duplicate = repositoryDouble({
      productType: "hose_end",
      sku: "601R1_TEST_04",
    });
    await expect(
      maintainManualHose(duplicate.repository, {
        actorId: "owner-1",
        ...validSubmission(),
      }),
    ).rejects.toThrow("already exists");

    const invalidImage = validSubmission();
    invalidImage.mainImageReference = "hose-series:601R2";
    const clean = repositoryDouble(null);
    await expect(
      maintainManualHose(clean.repository, {
        actorId: "owner-1",
        ...invalidImage,
      }),
    ).rejects.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: "main_image_required" }),
      ]),
    });
    expect(clean.writes).toHaveLength(0);
  });
});
