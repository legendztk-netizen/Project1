import {
  catalogWorksheetContracts,
  type CatalogFieldContract,
} from "./catalog-workbook";
import { productFields, packagingFields } from "./catalog-product-fields";
import { itemCurrencies } from "./catalog-item-publication";
import type { CommercialProductType } from "./catalog-commercial-maintenance";

export const importHelperSheets = ["00_填写说明", "09_字段字典", "10_下拉选项"];
export const importOperations = ["Update", "PartialUpdate", "Delete"] as const;
export const importOperationField: TemplateField = {
  key: "updateDelete",
  header: "Update Delete",
  kind: "text",
  required: true,
  controlledValues: [...importOperations],
  requirement: "必填",
};
export const importTemplates = [
  { prefix: "01", label: "胶管", type: "hose" },
  { prefix: "02", label: "压接接头", type: "hose_end" },
  { prefix: "03", label: "套筒", type: "ferrule" },
  { prefix: "04", label: "兼容压接", type: null },
  { prefix: "05", label: "过渡接头", type: "adapter" },
  { prefix: "06", label: "快速接头", type: "quick_coupler" },
] as const;

export const integratedPriceFields: CatalogFieldContract[] = [
  {
    key: "amount",
    header: "Retail Unit Price / 零售单价",
    kind: "number",
    required: false,
  },
  {
    key: "currency",
    header: "Currency / 币种",
    kind: "text",
    required: false,
    controlledValues: [...itemCurrencies],
  },
  {
    key: "packageLengthFt",
    header: "Package Length ft / 包装长度（英尺）",
    kind: "number",
    required: false,
  },
  ...packagingFields,
];

export type TemplateField = CatalogFieldContract & { requirement: string };
export function importTemplateFields(prefix: string): TemplateField[] {
  const template = importTemplates.find((t) => t.prefix === prefix);
  if (!template) throw new Error("Unknown import template");
  const contract = catalogWorksheetContracts.find((c) =>
    c.name.startsWith(prefix),
  )!;
  if (!template.type)
    return [
      importOperationField,
      ...contract.fields.map((f) => ({
        ...f,
        requirement: f.required ? "必填" : "选填",
      })),
    ];
  const type: CommercialProductType = template.type;
  const fields: TemplateField[] = productFields(type, "sku")
    .filter((f) => f.key !== "seriesMainImageReference")
    .map((f) => ({ ...f, requirement: f.required ? "必填" : "选填" }));
  for (const field of productFields(type, "series")) {
    if (field.key === "seriesCode" || fields.some((f) => f.key === field.key))
      continue;
    fields.push({
      ...field,
      requirement: field.required ? "系列必填" : "选填",
    });
  }
  for (const field of integratedPriceFields) {
    if (field.key === "packageLengthFt" && type !== "hose") continue;
    fields.push({
      ...field,
      requirement:
        field.key === "amount"
          ? "上线必填"
          : field.key === "packageLengthFt"
            ? "预包装必填"
            : "选填",
    });
  }
  fields.push(
    {
      key: "catalogPublicationStatus",
      header: "Catalog Publication Status / 产品状态",
      kind: "text",
      required: false,
      controlledValues: ["Published", "Draft", "Archived"],
      requirement: "选填",
    },
    {
      key: "seriesMediaVersionId",
      header: "Series Image Version / 系列图片版本",
      kind: "text",
      required: false,
      requirement: "图片二选一",
    },
    {
      key: "mediaVersionId",
      header: "SKU Image Version / SKU图片版本",
      kind: "text",
      required: false,
      requirement: "图片二选一",
    },
  );
  return [importOperationField, ...fields];
}
