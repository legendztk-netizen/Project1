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

describe("01-04 catalog workbook contract", () => {
  it("normalizes the supplied finished workbook without inventing relationships", () => {
    const result = validateCatalogWorkbook(fixture);

    expect(result.blockingErrors).toEqual([]);
    expect(result.draft).not.toBeNull();
    expect(result.draft).toMatchObject({
      hoseSeries: ["601R1", "601R2", "EN1SC", "EN2SC", "EN4SH", "EN4SP"],
    });
    expect(result.draft?.hoseVariants).toHaveLength(61);
    expect(result.draft?.hoseEnds).toHaveLength(200);
    expect(result.draft?.ferrules).toHaveLength(61);
    expect(result.draft?.compatibilities).toHaveLength(1081);

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

    const compatibility = result.draft?.compatibilities[0];
    expect(compatibility).toMatchObject({
      productionApprovalStatus: "not_approved",
      qualificationStatus: "Not Tested",
      rfqEligibility: "Eligible",
      technicalDataStatus: "Pending",
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
});
