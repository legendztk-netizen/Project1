import {
  catalogWorksheetContracts,
  type CatalogFieldContract,
  type CatalogWorkbookCell,
} from "./catalog-workbook";
import type { CommercialProductType } from "./catalog-commercial-maintenance";
import type { CatalogItemPayload } from "./catalog-item-publication";
export const productTypeLabels: Record<CommercialProductType, string> = {
  hose: "胶管",
  hose_end: "压接接头",
  ferrule: "套筒",
  adapter: "过渡接头",
  quick_coupler: "快速接头",
};
const sheets = {
  hose: "01_胶管主数据",
  hose_end: "02_压接接头",
  ferrule: "03_套筒",
  adapter: "05_过渡接头",
  quick_coupler: "06_快速接头",
};
const hoseKeys = [
  "sku",
  "hoseSeries",
  "dash",
  "nominalIdIn",
  "idMm",
  "odMm",
  "workingBar",
  "workingPsi",
  "burstBar",
  "bendRadiusMm",
  "weightKgM",
  "skiveRequirement",
  "mshaMarking",
  "technicalDataStatus",
  "source",
  "notes",
];
const endKeys = [
  "sku",
  "fittingSeries",
  "competitorPartNumber",
  "connectionDash",
  "hoseTailDash",
  "thread",
  "material",
  "coating",
  "maxWorkingBar",
  "dimensionAMm",
  "cutoffBMm",
  "hex1Mm",
  "hex2Mm",
  "minimumBoreMm",
  "unitWeightG",
  "saltSprayHours",
  "drawingNumber",
  "drawingRevision",
  "technicalDataStatus",
  "source",
  "notes",
];
const hoseSeriesKeys = [
  "seriesCode",
  "seriesName",
  "primaryStandard",
  "equivalentStandard",
  "tempMinC",
  "tempMaxC",
  "tubeMaterial",
  "reinforcement",
  "coverMaterial",
  "coverColor",
  "coverFinish",
  "fluidCompatibility",
];
const endSeriesKeys = [
  "seriesCode",
  "seriesName",
  "interfaceFamily",
  "interfaceStandard",
  "gender",
  "swivelForm",
  "angle",
  "sealingForm",
];
export function productFields(
  type: CommercialProductType,
  kind: "series" | "sku",
): CatalogFieldContract[] {
  const original = catalogWorksheetContracts.find(
    (c) => c.name === sheets[type],
  )!.fields;
  const keys =
    kind === "series"
      ? type === "hose"
        ? hoseSeriesKeys
        : type === "hose_end"
          ? endSeriesKeys
          : ["seriesCode", "seriesName"]
      : type === "hose"
        ? hoseKeys
        : type === "hose_end"
          ? endKeys
          : original
              .filter(
                (f) =>
                  !["catalogPublicationStatus", "rfqEligibility"].includes(
                    f.key,
                  ),
              )
              .map((f) => f.key);
  return keys.map((key) => {
    const field = original.find(
      (f) =>
        f.key === (key === "interfaceStandard" ? "connectionStandard" : key),
    );
    return field
      ? {
          ...field,
          key: key === "adapterSku" ? "sku" : key,
          required:
            field.required ||
            (["notes", "workingPsi"].includes(key) && type === "hose") ||
            ([
              "notes",
              "maxWorkingBar",
              "dimensionAMm",
              "cutoffBMm",
              "hex1Mm",
              "hex2Mm",
              "minimumBoreMm",
              "unitWeightG",
              "saltSprayHours",
            ].includes(key) &&
              type === "hose_end"),
        }
      : {
          key,
          kind: "text",
          required: true,
          header:
            key === "seriesCode"
              ? "Series Code / 系列编号"
              : key === "seriesName"
                ? "Series Name / 系列名称"
                : key,
        };
  });
}
export const packagingFields: CatalogFieldContract[] = [
  ["unitsPerSalesPack", "Units per Sales Pack / 每销售包装数量"],
  ["netUnitWeightKg", "Net Unit Weight kg / 单位净重"],
  ["innerPackQty", "Inner Pack Qty / 内包装数量"],
  ["masterCartonQty", "Master Carton Qty / 每外箱数量"],
  ["cartonGrossWeightKg", "Carton Gross Weight kg / 整箱毛重"],
  ["cartonLCm", "Carton L cm / 箱长"],
  ["cartonWCm", "Carton W cm / 箱宽"],
  ["cartonHCm", "Carton H cm / 箱高"],
  ["packingBasis", "Packing Basis / 装箱依据"],
].map(([key, header]) => ({
  key,
  header,
  kind: key === "packingBasis" ? "text" : "number",
  required: false,
}));
export function productValuesFromForm(
  form: FormData,
  type: CommercialProductType,
  kind: "series" | "sku",
) {
  return Object.fromEntries(
    productFields(type, kind).map((field) => {
      const raw = String(form.get(field.key) ?? "").trim();
      return [
        field.key,
        field.kind === "number" ? (raw ? Number(raw) : null) : raw || null,
      ];
    }),
  ) as Record<string, CatalogWorkbookCell>;
}
export function ownedProductValues(payload: CatalogItemPayload) {
  return (payload.kind === "series"
    ? payload.series
    : payload.variant) as unknown as Record<string, string | number | null>;
}
