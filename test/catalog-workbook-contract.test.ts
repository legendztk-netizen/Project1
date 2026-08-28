import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  validateCatalogWorkbook,
  type CatalogWorkbookSheet,
} from "../app/modules/catalog/domain/catalog-workbook";
import { readCatalogWorkbook } from "../app/modules/catalog/infrastructure/read-catalog-workbook";

const workbookPath = fileURLToPath(
  new URL(
    "./fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    import.meta.url,
  ),
);

let fixture: CatalogWorkbookSheet[];

function cloneFixture() {
  return structuredClone(fixture);
}

function sheetByName(sheets: CatalogWorkbookSheet[], name: string) {
  const sheet = sheets.find((candidate) => candidate.sheet === name);
  if (!sheet) throw new Error(`Missing fixture sheet ${name}`);
  return sheet;
}

beforeAll(async () => {
  const file = await readFile(workbookPath);
  fixture = await readCatalogWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  );
});

describe("01-07 catalog workbook contract", () => {
  it("normalizes the supplied finished workbook without inventing relationships", () => {
    const result = validateCatalogWorkbook(fixture);

    expect(result.blockingErrors).toEqual([]);
    expect(result.draft).not.toBeNull();
    expect(result.draft).toMatchObject({
      hoseSeries: ["601R1", "601R2", "EN1SC", "EN2SC", "EN4SH", "EN4SP"],
    });
    expect(result.draft?.hoseVariants).toHaveLength(61);
    expect(result.draft?.hoseEnds).toHaveLength(329);
    expect(result.draft?.ferrules).toHaveLength(61);
    expect(result.draft?.compatibilities).toHaveLength(1210);
    expect(result.draft?.adapterFamilies).toHaveLength(17);
    expect(result.draft?.adapters).toHaveLength(136);
    expect(result.draft?.quickCouplers).toHaveLength(57);
    expect(result.draft?.salesOffers).toHaveLength(644);
    expect(result.draft?.costBases).toHaveLength(644);
    expect(result.draft?.skus).toHaveLength(644);

    const hoseEnd = result.draft?.hoseEnds.find(
      (row) => row.sku === "ORFS90_F_SW_20_16",
    );
    expect(hoseEnd).toMatchObject({
      connectionDash: "-20",
      connectionStandard: "SAE J1453 / ISO 8434-3",
      gender: "Female",
      hoseTailDash: "-16",
      interfaceFamily: "ORFS",
      sealingForm: "O-ring face seal",
      swivelForm: "Swivel",
      thread: "1-11/16-12 UN",
    });

    expect(result.draft?.hoseEnds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fittingSeries: "MPX Hydraulax R1 reference",
          interfaceFamily: "NPTF",
          sku: "NPT_M_SW_08_10",
        }),
        expect.objectContaining({
          connectionStandard: "NPSM / ASME B1.20.1",
          fittingSeries: "FPX Hydraulax R1 reference",
          sku: "NPSM_F_SW_12_12",
        }),
        expect.objectContaining({
          fittingSeries: "MB Hydraulax R1 reference",
          sku: "ORB_M_FX_10_10",
        }),
        expect.objectContaining({
          fittingSeries: "MBX Hydraulax R1 reference",
          sku: "ORB_M_SW_12_12",
        }),
        expect.objectContaining({
          fittingSeries: "MBX90 Hydraulax R1 reference",
          sku: "ORB90_M_SW_10_10",
        }),
        expect.objectContaining({
          fittingSeries: "C61 Hydraulax R1 reference",
          sku: "C61_N_FX_12_12",
        }),
        expect.objectContaining({
          fittingSeries: "C6145 Hydraulax R1 reference",
          sku: "C6145_N_FX_12_12",
        }),
        expect.objectContaining({
          fittingSeries: "C6190 Hydraulax R1 reference",
          sku: "C6190_N_FX_12_12",
        }),
        expect.objectContaining({
          fittingSeries: "FJX90L Hydraulax R1 reference (Long)",
          sku: "JIC90L_F_SW_10_10",
        }),
        expect.objectContaining({
          fittingSeries: "FJX90M Hydraulax R1 reference (Medium)",
          sku: "JIC90M_F_SW_10_10",
        }),
        expect.objectContaining({
          fittingSeries: "FFX90L Hydraulax R1 reference (Long)",
          sku: "ORFS90L_F_SW_10_10",
        }),
        expect.objectContaining({
          fittingSeries: "FFX90M Hydraulax R1 reference (Medium)",
          sku: "ORFS90M_F_SW_10_10",
        }),
      ]),
    );

    const compatibility = result.draft?.compatibilities[0];
    expect(compatibility).toMatchObject({
      productionApprovalStatus: "not_approved",
      qualificationStatus: "Not Tested",
      rfqEligibility: "Eligible",
      technicalDataStatus: "Pending",
    });

    const adapter = result.draft?.adapters.find(
      (row) => row.sku === "ADP_ST_JIC_M_10_NPT_M_04",
    );
    expect(adapter).toMatchObject({
      connectionForm1: "M",
      connectionForm2: "M",
      interface1: "JIC",
      interface2: "NPT",
      shapeCode: "ST",
      size1: "-10",
      size2: "-4",
    });

    const quickCoupler = result.draft?.quickCouplers.find(
      (row) => row.sku === "QDC_16028_SOC_04_FNPT_04",
    );
    expect(quickCoupler).toMatchObject({
      bodyDash: "04",
      bodyMaterial: null,
      bodySize: "1/4 in",
      interchangeStandard: "ISO 16028",
      maxWorkingBar: null,
      portCode: "FNPT",
      portDash: "04",
      portInterface: "NPTF",
      role: "Coupler/Socket",
      skuRoleCode: "SOC",
      skuStandardCode: "16028",
      technicalDataStatus: "Pending",
    });

    const publicOffer = result.draft?.salesOffers.find(
      (row) => row.salesSku === "601R1_001",
    );
    expect(publicOffer).toMatchObject({
      cartonGrossWeightKg: null,
      currency: "USD",
      referencePriceUsd: 2.16,
    });
    expect(result.draft?.costBases[0]).toMatchObject({
      currency: "USD",
      factoryUnitPrice: null,
      tierPrice: null,
    });
    expect(result.draft?.skus.every((sku) => sku.supplyAvailability)).toBe(
      true,
    );
    expect(
      result.draft?.skus.every(
        (sku) => sku.supplyAvailability === "temporarily_unavailable",
      ),
    ).toBe(true);
  });

  it("rejects duplicate stable SKUs with row-specific results", () => {
    const sheets = cloneFixture();
    const hoses = sheetByName(sheets, "01_胶管主数据");
    hoses.data[5][1] = hoses.data[4][1];

    const result = validateCatalogWorkbook(sheets);

    expect(result.draft).toBeNull();
    expect(result.blockingErrors).toContainEqual(
      expect.objectContaining({
        field: "Hose SKU / 胶管SKU",
        message: expect.stringContaining("Duplicate SKU"),
        row: 6,
        severity: "error",
        sku: "601R1_001",
        worksheet: "01_胶管主数据",
      }),
    );
  });

  it("rejects broken exact foreign keys rather than inferring from Dash", () => {
    const sheets = cloneFixture();
    const compatibility = sheetByName(sheets, "04_兼容压接");
    compatibility.data[4][3] = "MISSING_END_WITH_MATCHING_DASH";

    const result = validateCatalogWorkbook(sheets);

    expect(result.draft).toBeNull();
    expect(result.blockingErrors).toContainEqual(
      expect.objectContaining({
        field: "Hose End SKU / 接头SKU",
        message: expect.stringContaining("does not exist in 02_压接接头"),
        row: 5,
        sku: "601R1_002",
        worksheet: "04_兼容压接",
      }),
    );
  });

  it("rejects invalid controlled values and malformed unit-bearing numbers", () => {
    const sheets = cloneFixture();
    const hoses = sheetByName(sheets, "01_胶管主数据");
    hoses.data[4][0] = "Live Maybe";
    hoses.data[4][5] = "-999";
    hoses.data[4][7] = "5 mm";
    hoses.data[4][21] = "Invented Skive";

    const result = validateCatalogWorkbook(sheets);

    expect(result.draft).toBeNull();
    expect(result.blockingErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "Catalog Publication Status / 目录发布状态",
          message: expect.stringContaining("controlled value"),
          row: 5,
        }),
        expect.objectContaining({
          field: "Hose Dash / 胶管Dash",
          message: expect.stringContaining("controlled value"),
          row: 5,
        }),
        expect.objectContaining({
          field: "ID mm / 内径毫米",
          message: expect.stringContaining("number without a unit suffix"),
          row: 5,
        }),
        expect.objectContaining({
          field: "Skive Requirement / 剥胶要求",
          message: expect.stringContaining("controlled value"),
          row: 5,
        }),
      ]),
    );
  });

  it("rejects a duplicate exact Hose/End/Ferrule tuple", () => {
    const sheets = cloneFixture();
    const compatibility = sheetByName(sheets, "04_兼容压接");
    compatibility.data[5][2] = compatibility.data[4][2];
    compatibility.data[5][3] = compatibility.data[4][3];
    compatibility.data[5][4] = compatibility.data[4][4];

    const result = validateCatalogWorkbook(sheets);

    expect(result.draft).toBeNull();
    expect(result.blockingErrors).toContainEqual(
      expect.objectContaining({
        field: "Hose SKU + Hose End SKU + Ferrule SKU",
        message: expect.stringContaining("Duplicate exact compatibility tuple"),
        row: 6,
        sku: "601R1_002",
      }),
    );
  });

  it("blocks orphaned and duplicate worksheet 07 price references", () => {
    const orphaned = cloneFixture();
    const orphanPrices = sheetByName(orphaned, "07_价格包装");
    orphanPrices.data[4][2] = "MISSING_PRODUCT";

    const orphanResult = validateCatalogWorkbook(orphaned);

    expect(orphanResult.draft).toBeNull();
    expect(orphanResult.blockingErrors).toContainEqual(
      expect.objectContaining({
        code: "orphan_price_row",
        field: "Base SKU / 基础SKU",
        row: 5,
        sku: "601R1_001",
      }),
    );

    const duplicated = cloneFixture();
    const duplicatePrices = sheetByName(duplicated, "07_价格包装");
    duplicatePrices.data[5][2] = duplicatePrices.data[4][2];
    duplicatePrices.data[5][3] = duplicatePrices.data[4][3];

    const duplicateResult = validateCatalogWorkbook(duplicated);

    expect(duplicateResult.draft).toBeNull();
    expect(duplicateResult.blockingErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_price_row",
          field: "Base SKU / 基础SKU",
          row: 6,
        }),
        expect.objectContaining({
          code: "duplicate_price_row",
          field: "Sales SKU / 销售SKU",
          row: 6,
        }),
      ]),
    );
  });

  it("requires explicit USD currency when a public or internal price exists", () => {
    const sheets = cloneFixture();
    const prices = sheetByName(sheets, "07_价格包装");
    prices.data[4][11] = null;

    const result = validateCatalogWorkbook(sheets);

    expect(result.draft).toBeNull();
    expect(result.blockingErrors).toContainEqual(
      expect.objectContaining({
        code: "price_currency_required",
        field: "Currency / 币种",
        row: 5,
      }),
    );
  });

  it("keeps worksheet 07 product type and status aligned with the exact Base SKU", () => {
    const sheets = cloneFixture();
    const prices = sheetByName(sheets, "07_价格包装");
    prices.data[4][1] = "Adapter";
    prices.data[4][27] = "Blocked";

    const result = validateCatalogWorkbook(sheets);

    expect(result.draft).toBeNull();
    expect(result.blockingErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "price_product_type_mismatch",
          field: "Product Type / 产品类型",
          row: 5,
        }),
        expect.objectContaining({
          code: "price_status_mismatch",
          field: "RFQ Eligibility / 询价资格",
          row: 5,
        }),
      ]),
    );
  });

  it("blocks impossible worksheet 07 quantities and prices", () => {
    const sheets = cloneFixture();
    const prices = sheetByName(sheets, "07_价格包装");
    prices.data[4][7] = 1.5;
    prices.data[4][17] = -1;

    const result = validateCatalogWorkbook(sheets);

    expect(result.draft).toBeNull();
    expect(result.blockingErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_positive_integer",
          field: "MOQ / 最小起订量",
          row: 5,
        }),
        expect.objectContaining({
          code: "invalid_positive_number",
          field: "Retail Unit Price USD / 零售单价",
          row: 5,
        }),
      ]),
    );
  });
});
