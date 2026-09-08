import { describe, expect, it } from "vitest";
import {
  planItemImport,
  type ImportBaseline,
} from "../app/modules/catalog/domain/catalog-item-import";
import type { CatalogWorkbookSheet } from "../app/modules/catalog/domain/catalog-workbook";
import type { CatalogItemPayload } from "../app/modules/catalog/domain/catalog-item-publication";
const sku: CatalogItemPayload = {
  kind: "sku",
  productType: "hose",
  variant: {
    sku: "A_001",
    hoseSeries: "A",
    dash: "-04",
    notes: "kept",
  } as never,
  price: { amount: 3, currency: "USD", packageLengthFt: null },
  mediaVersionId: "image",
};
const series: CatalogItemPayload = {
  kind: "series",
  productType: "hose",
  series: { seriesCode: "A", seriesName: "A", tempMinC: -40 } as never,
  commercialRule: null,
  mediaVersionId: "image",
};
const baseline = async (
  _type: unknown,
  kind: string,
  code: string,
): Promise<ImportBaseline | null> =>
  code === (kind === "series" ? "A" : "A_001")
    ? {
        payload: kind === "series" ? series : sku,
        state: "online",
        revisionId: "baseline",
      }
    : null;
const plan = (sheets: CatalogWorkbookSheet[]) =>
  planItemImport({
    sheets,
    baseline,
    actorId: "owner",
    ipAddress: "local",
    batchId: "batch-test",
  });
describe("item workbook snapshots", () => {
  it("inherits absent columns, clears optional blanks and does not create unchanged series or missing-row deletions", async () => {
    const result = await plan([
      {
        sheet: "01_胶管主数据",
        data: [
          ["sku", "mshaMarking"],
          ["A_001", null],
        ],
      },
    ]);
    expect(result.requests).toHaveLength(0);
    const changed = await plan([
      {
        sheet: "01_胶管主数据",
        data: [
          ["sku", "dash"],
          ["A_001", "-06"],
        ],
      },
    ]);
    expect(changed.requests).toHaveLength(1);
    expect(changed.requests[0].command.payload).toMatchObject({
      variant: { dash: "-06", notes: "kept" },
    });
  });
  it("keeps duplicate sources and rejects conflicting values", async () => {
    const result = await plan([
      {
        sheet: "01_胶管主数据",
        data: [
          ["sku", "dash"],
          ["A_001", "-06"],
          ["A_001", "-06"],
          ["A_001", "-08"],
        ],
      },
    ]);
    expect(result.requests[0].sources).toHaveLength(3);
    expect(result.requests[0].issues.join()).toContain("冲突");
  });
  it("owns non-USD retail prices without exposing cost basis", async () => {
    const result = await plan([
      {
        sheet: "07_价格包装",
        data: [
          [
            "productType",
            "baseSku",
            "Retail Unit Price / 零售单价",
            "currency",
            "factoryUnitPrice",
          ],
          ["Hose Variant", "A_001", 28, "CNY", 10],
        ],
      },
    ]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].command.payload).toMatchObject({
      price: { amount: 28, currency: "CNY" },
    });
    expect(JSON.stringify(result.requests[0].command.payload)).not.toContain(
      "factoryUnitPrice",
    );
    expect(result.requests[0].sources[0].values.factoryUnitPrice).toBe(10);
  });
  it("rejects relabelled USD and conflicting retail columns", async () => {
    const result = await plan([
      {
        sheet: "07_价格包装",
        data: [
          ["productType", "baseSku", "referencePriceUsd", "amount", "currency"],
          ["Hose Variant", "A_001", 3, 28, "CNY"],
        ],
      },
    ]);
    expect(result.requests[0].issues.join()).toContain("USD");
    expect(result.requests[0].issues.join()).toContain("冲突");
  });
  it("retains sheet04 independently and creates new parent dependencies", async () => {
    const result = await plan([
      {
        sheet: "01_胶管主数据",
        data: [
          ["sku", "hoseSeries", "dash"],
          ["B_001", "B", "-04"],
        ],
      },
      {
        sheet: "04_兼容与扣压",
        data: [
          ["hoseSeries", "fittingSeries"],
          ["B", "FJX"],
        ],
      },
    ]);
    expect(result.relations).toHaveLength(1);
    const parent = result.requests.find(
      (r) => r.command.payload.kind === "series",
    )!;
    expect(
      result.requests.find((r) => r.command.payload.kind === "sku")
        ?.dependencies,
    ).toEqual([parent.id]);
  });
  it("present required blanks block approval instead of inheriting", async () => {
    const result = await plan([
      {
        sheet: "01_胶管主数据",
        data: [
          ["sku", "dash"],
          ["A_001", null],
        ],
      },
    ]);
    expect(result.requests[0].issues.join()).toContain("不能为空");
  });
});
it("infers an existing SKU type for price-only sheets without a productType column", async () => {
  const result = await plan([
    {
      sheet: "07_价格包装",
      data: [
        ["baseSku", "amount"],
        ["A_001", 11],
      ],
    },
  ]);
  expect(result.requests).toHaveLength(1);
  expect(result.requests[0].command.payload).toMatchObject({
    productType: "hose",
    price: { amount: 11, currency: "USD" },
  });
});
it("applies legacy series image references and rejects conflicting image columns", async () => {
  const result = await plan([
    {
      sheet: "01_胶管主数据",
      data: [
        ["sku", "seriesMainImageReference"],
        ["A_001", "media-version:replacement"],
      ],
    },
  ]);
  expect(result.requests).toHaveLength(1);
  expect(result.requests[0].command.payload).toMatchObject({
    kind: "series",
    mediaVersionId: "replacement",
  });
  const conflict = await plan([
    {
      sheet: "01_胶管主数据",
      data: [
        ["sku", "seriesMainImageReference", "seriesMediaVersionId"],
        ["A_001", "media-version:replacement", "different"],
      ],
    },
  ]);
  expect(
    conflict.requests
      .find((r) => r.command.payload.kind === "series")
      ?.issues.join(),
  ).toContain("冲突");
});
