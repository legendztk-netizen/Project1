import * as XLSX from "@e965/xlsx";
import { redirect } from "react-router";
import { importTemplates } from "../../catalog/domain/catalog-import-template";
import type { Route } from "./+types/catalog-item-template";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { catalogWorksheetContracts } from "../../catalog/domain/catalog-workbook";
export function loader({ context, request }: Route.LoaderArgs) {
  requireAdminRequestContext(context);
  const prefix = new URL(request.url).searchParams.get("sheet");
  if (prefix) {
    if (!importTemplates.some((t) => t.prefix === prefix))
      throw new Response("Unknown template", { status: 400 });
    return redirect(`/templates/catalog-import-${prefix}.xlsx`);
  }
  const workbook = XLSX.utils.book_new();
  for (const contract of catalogWorksheetContracts) {
    const headers = contract.fields
      .filter((f) => f.key !== "seriesMainImageReference")
      .map((f) =>
        f.key === "referencePriceUsd"
          ? "Retail Unit Price / 零售单价"
          : f.header,
      );
    if (!contract.name.startsWith("04")) {
      if (
        !contract.name.startsWith("07") &&
        !contract.fields.some((f) => f.key === "seriesName")
      )
        headers.push("Series Name / 系列名称");
      headers.push(
        "Series Image Version / 系列图片版本",
        "SKU Image Version / SKU图片版本",
      );
    }
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([headers]),
      contract.name,
    );
  }
  return new Response(
    XLSX.write(workbook, { type: "array", bookType: "xlsx" }),
    {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="catalog-item-import.xlsx"',
        "Cache-Control": "private, no-store",
      },
    },
  );
}
