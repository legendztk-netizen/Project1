import * as XLSX from "@e965/xlsx";
import { expect, it } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { loader } from "../app/modules/admin/routes/catalog-item-template";
import { catalogWorksheetContracts } from "../app/modules/catalog/domain/catalog-workbook";
import { planItemImport } from "../app/modules/catalog/domain/catalog-item-import";
it("downloads a seven-sheet template whose master columns do not collide when imported", async () => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: {} as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
    adminIdentity: {
      id: "owner",
      email: "owner@example.com",
      accountType: "owner",
      source: "local-development",
      canManageSubaccounts: true,
    },
  });
  const response = loader({ context } as Parameters<typeof loader>[0]);
  const book = XLSX.read(await response.arrayBuffer(), { type: "array" });
  expect(book.SheetNames).toHaveLength(7);
  const sheets = book.SheetNames.filter(
    (name) => name.startsWith("01") || name.startsWith("02"),
  ).map((sheet) => {
    const headers = (
      XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1 }) as string[][]
    )[0];
    const fields = catalogWorksheetContracts.find(
      (c) => c.name === sheet,
    )!.fields;
    const values = headers.map((header) => {
      const f = fields.find((f) => f.header === header);
      return f?.key === "sku"
        ? `SKU_${sheet.slice(0, 2)}`
        : f?.key === "hoseSeries" || f?.key === "fittingSeries"
          ? "SERIES"
          : f?.kind === "number"
            ? 1
            : f?.required
              ? (f.controlledValues?.[0] ?? "Value")
              : null;
    });
    return { sheet, data: [headers, values] };
  });
  const plan = await planItemImport({
    sheets,
    batchId: "template-test",
    actorId: "owner",
    ipAddress: "local",
    baseline: async () => null,
  });
  expect(plan.requests.length).toBeGreaterThan(0);
  expect(plan.requests.flatMap((r) => r.issues).join()).not.toContain("重复列");
  expect(
    plan.requests.flatMap((r) =>
      r.sources.flatMap((s) => Object.keys(s.values)),
    ),
  ).not.toContain("seriesMainImageReference");
});
