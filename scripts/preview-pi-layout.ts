import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { renderProformaInvoicePdf } from "../app/modules/proforma-invoice/domain/proforma-invoice-pdf";
import { piUnicodeFonts } from "../app/modules/proforma-invoice/domain/pi-unicode-font";

const [database, documentNumber, output] = process.argv.slice(2);
if (!database || !/^PI-[A-Z0-9-]+$/.test(documentNumber ?? "") || !output)
  throw new Error("Usage: preview-pi-layout.ts database PI-number output.pdf");
const json = execFileSync(
  "sqlite3",
  [
    database,
    `SELECT snapshot_json FROM proforma_invoices WHERE document_number='${documentNumber}'`,
  ],
  { encoding: "utf8" },
);
const snapshot = JSON.parse(json);
const pdf = await renderProformaInvoicePdf(
  snapshot,
  piUnicodeFonts({
    fontkit,
    snapshot,
    loadFont: async (asset) =>
      readFile(
        new URL(
          `../app/modules/proforma-invoice/domain/fonts/${asset.filename === "NotoSans-Regular.ttf" ? "" : "chunks/"}${asset.filename}`,
          import.meta.url,
        ),
      ),
  }),
);
await mkdir(new URL("../output/pdf/", import.meta.url), { recursive: true });
await writeFile(output, pdf.bytes);
console.log(
  JSON.stringify({ output, pages: pdf.pageCount, bytes: pdf.bytes.length }),
);
