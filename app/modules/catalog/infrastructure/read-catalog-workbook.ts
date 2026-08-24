import * as XLSX from "@e965/xlsx";

import type { CatalogWorkbookSheet } from "../domain/catalog-workbook";

export async function readCatalogWorkbook(input: ArrayBuffer) {
  const workbook = XLSX.read(input, { cellDates: true, type: "array" });
  return workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, {
      defval: null,
      header: 1,
      raw: true,
    });
    return { data, sheet: sheetName } as CatalogWorkbookSheet;
  });
}
