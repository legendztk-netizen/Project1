import { readFileSync } from "node:fs";
import * as XLSX from "@e965/xlsx";
import { describe, expect, it } from "vitest";
import {
  importTemplates,
  importTemplateFields,
  importHelperSheets,
} from "../app/modules/catalog/domain/catalog-import-template";
import { productFields } from "../app/modules/catalog/domain/catalog-product-fields";
import { planItemImport } from "../app/modules/catalog/domain/catalog-item-import";
import type { CatalogWorkbookSheet } from "../app/modules/catalog/domain/catalog-workbook";

function readTemplate(prefix: string): CatalogWorkbookSheet[] {
  const book = XLSX.read(
    readFileSync(
      new URL(
        `../public/templates/catalog-import-${prefix}.xlsx`,
        import.meta.url,
      ),
    ),
    { cellStyles: true },
  );
  return book.SheetNames.map((sheet) => ({
    sheet,
    data: XLSX.utils.sheet_to_json(book.Sheets[sheet], {
      header: 1,
      defval: null,
    }),
  }));
}
const plan = (sheets: CatalogWorkbookSheet[]) =>
  planItemImport({
    sheets,
    batchId: "split-template",
    actorId: "owner",
    ipAddress: "local",
    baseline: async () => null,
  });

describe("split import workbooks", () => {
  for (const t of importTemplates)
    it(`${t.prefix} ships matching headers and helper tabs, with no importable example rows`, async () => {
      const sheets = readTemplate(t.prefix);
      expect(sheets).toHaveLength(4);
      expect(sheets.map((s) => s.sheet)).toEqual(
        expect.arrayContaining(importHelperSheets),
      );
      const main = sheets.find((s) => s.sheet.startsWith(t.prefix))!;
      const fields = importTemplateFields(t.prefix);
      for (const field of fields.filter((f) =>
        ["technicalDataStatus", "source", "notes"].includes(f.key),
      )) {
        expect(field.required).toBe(false);
        expect(field.requirement).toBe("选填");
      }
      expect(main.data[0]).toEqual(
        fields.map(
          (f) => `${f.header.replace(/\*/g, "").trim()} [${f.requirement}]`,
        ),
      );
      const result = await plan(sheets);
      expect(result).toEqual({ requests: [], relations: [], issues: [] });
      if (t.type)
        for (const f of productFields(t.type, "sku")) {
          if (f.key === "seriesMainImageReference") continue;
          expect(fields.find((x) => x.key === f.key)?.requirement).toBe(
            f.required ? "必填" : "选填",
          );
        }
    });
  for (const t of importTemplates.filter((t) => t.type))
    it(`${t.prefix} captures product, price and packaging in the same source request`, async () => {
      const sheets = readTemplate(t.prefix);
      const main = sheets.find((s) => s.sheet.startsWith(t.prefix))!;
      const fields = importTemplateFields(t.prefix);
      main.data = [
        main.data[0],
        fields.map((f) =>
          f.key === "amount"
            ? 28.25
            : f.key === "currency"
              ? "CNY"
              : f.key === "netUnitWeightKg"
                ? 0.75
                : f.key === "unitsPerSalesPack"
                  ? 2
                  : f.key === "packingBasis"
                    ? "Carton"
                    : f.key === "sku"
                      ? `TEST_${t.prefix}`
                      : f.required
                        ? (f.controlledValues?.[0] ??
                          (f.kind === "number" ? 1 : "TEST"))
                        : null,
        ),
      ];
      const result = await plan(sheets);
      expect(result.issues).toEqual([]);
      expect(result.requests.flatMap((r) => r.issues)).toEqual([]);
      const sku = result.requests.find(
        (r) => r.command.payload.kind === "sku",
      )!;
      expect(sku.command.payload).toMatchObject({
        price: {
          amount: 28.25,
          currency: "CNY",
          netUnitWeightKg: 0.75,
          unitsPerSalesPack: 2,
          packingBasis: "Carton",
        },
      });
      expect(sku.sources).toHaveLength(1);
      expect(sku.sources[0].sheet).toBe(main.sheet);
      expect(sku.dependencies).toHaveLength(1);
      expect(JSON.stringify(sku.command.payload)).not.toContain(
        "factoryUnitPrice",
      );
    });
  it("rejects a blank manual-required field and recognizes numeric packaging errors", async () => {
    const result = await plan([
      { sheet: "00_填写说明", data: [] },
      {
        sheet: "01_胶管主数据",
        data: [
          [
            "Hose SKU / 胶管SKU [必填]",
            "hoseSeries",
            "dash",
            "netUnitWeightKg",
          ],
          ["TEST", "SERIES", null, "invalid"],
        ],
      },
    ]);
    expect(result.requests.flatMap((r) => r.issues).join()).toContain(
      "dash：必填项不能为空",
    );
    expect(result.requests.flatMap((r) => r.issues).join()).toContain(
      "netUnitWeightKg：数值无效",
    );
  });
  it("does not hide unknown data sheets", async () => {
    expect(
      (await plan([{ sheet: "08_其他数据", data: [] }])).issues,
    ).toHaveLength(1);
  });
});
