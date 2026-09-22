import {
  importHelperSheets,
  importOperations,
  importTemplateFields,
  integratedPriceFields,
} from "./catalog-import-template";
import {
  validateCatalogWorksheetRecord,
  catalogWorksheetContracts,
  type CatalogWorkbookSheet,
  type CatalogWorkbookCell,
} from "./catalog-workbook";
import {
  productFields,
  packagingFields,
  ownedProductValues,
} from "./catalog-product-fields";
import {
  itemCode,
  itemCurrencies,
  type CatalogItemCommand,
  type CatalogItemPayload,
} from "./catalog-item-publication";
import type { CommercialProductType } from "./catalog-commercial-maintenance";

export const importSeriesKeys = {
  hose: "hoseSeries",
  hose_end: "fittingSeries",
  ferrule: "ferruleSeries",
  adapter: "adapterFamilyId",
  quick_coupler: "couplerSeries",
} as const;
const worksheetTypes: Record<string, CommercialProductType> = {
  "01": "hose",
  "02": "hose_end",
  "03": "ferrule",
  "05": "adapter",
  "06": "quick_coupler",
};
const offerTypes: Record<string, CommercialProductType> = {
  "Hose Variant": "hose",
  "Hose End": "hose_end",
  Ferrule: "ferrule",
  Adapter: "adapter",
  "Quick Coupler": "quick_coupler",
  "Quick Plug": "quick_coupler",
};
export const importRuleKeys = [
  "salesUnit",
  "quantityInputMode",
  "moq",
  "leadTimeDays",
  "countryOfOrigin",
  "hsCode",
  "notes",
  "minimumLengthPerPieceFt",
  "lengthIncrementFt",
  "presetLength1Ft",
  "presetLength2Ft",
  "presetLength3Ft",
  "continuousLengthConfirmation",
];
export interface ImportSource {
  sheet: string;
  row: number;
  values: Record<string, CatalogWorkbookCell>;
  cells: CatalogWorkbookCell[];
}
export interface ImportProposal {
  id: string;
  command: CatalogItemCommand;
  baseline: CatalogItemPayload | null;
  sources: ImportSource[];
  issues: string[];
  dependencies: string[];
}
export interface RelationSource {
  id: string;
  source: ImportSource;
  issues: string[];
}
export interface ItemImportPlan {
  requests: ImportProposal[];
  relations: RelationSource[];
  issues: string[];
}
export interface ImportBaseline {
  payload: CatalogItemPayload;
  revisionId: string | null;
  state: CatalogItemCommand["targetState"];
}
const identity = (type: string, kind: string, code: string) =>
  `${type}:${kind}:${code}`;
const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );
function comparable(payload: CatalogItemPayload) {
  const values = ownedProductValues(payload);
  return {
    ...payload,
    [payload.kind === "series" ? "series" : "variant"]: Object.fromEntries(
      productFields(payload.productType, payload.kind).map((f) => [
        f.key,
        values[f.key] ?? null,
      ]),
    ),
  };
}
function state(
  value: CatalogWorkbookCell | undefined,
): CatalogItemCommand["targetState"] | null {
  return (
    (
      {
        Published: "online",
        Draft: "draft",
        Archived: "discontinued",
        online: "online",
        draft: "draft",
        discontinued: "discontinued",
      } as const
    )[String(value) as "Published"] ?? null
  );
}

/** Build immutable, item-owned snapshots. Unspecified columns inherit only this captured baseline. */
export async function planItemImport(input: {
  sheets: CatalogWorkbookSheet[];
  batchId: string;
  actorId: string;
  ipAddress: string;
  resolveMediaReference?(reference: string): Promise<string | null>;
  baseline(
    type: CommercialProductType,
    kind: "series" | "sku",
    code: string,
  ): Promise<ImportBaseline | null>;
}): Promise<ItemImportPlan> {
  const splitTemplate = input.sheets.some((sheet) =>
    (sheet.data[0] ?? []).some((cell) => String(cell).endsWith("[必填]")),
  );
  const proposals = new Map<string, ImportProposal>();
  const assignments = new Map<string, Map<string, string>>();
  const issues: string[] = [];
  const relations: RelationSource[] = [];
  const records: { source: ImportSource; prefix: string; errors: string[] }[] =
    [];
  for (const sheet of input.sheets) {
    if (importHelperSheets.includes(sheet.sheet)) continue;
    const prefix = sheet.sheet.slice(0, 2);
    const contract = catalogWorksheetContracts.find(
      (c) => c.name.slice(0, 2) === prefix,
    );
    if (!contract) {
      issues.push(`未知工作表：${sheet.sheet}`);
      continue;
    }
    const fields =
      prefix === "07"
        ? contract.fields
        : [
            ...contract.fields,
            ...importTemplateFields(prefix),
            ...integratedPriceFields,
          ];
    const aliases = new Map(
      fields.flatMap((f) => [
        [normalizeHeader(f.header), f.key],
        [f.key, f.key],
      ]),
    );
    for (const [header, key] of [
      ["Retail Unit Price / 零售单价", "amount"],
      ["amount", "amount"],
      ["Series Code / 系列编号", "seriesCode"],
      ["Series Name / 系列名称", "seriesName"],
      ["Series Image Version / 系列图片版本", "seriesMediaVersionId"],
      ["SKU Image Version / SKU图片版本", "mediaVersionId"],
    ]) {
      aliases.set(header, key);
      aliases.set(key, key);
    }
    if (prefix !== "07")
      for (const f of importTemplateFields(prefix)) {
        aliases.set(normalizeHeader(`${f.header} [${f.requirement}]`), f.key);
      }
    const headers = (sheet.data[0] ?? []).map(
      (h) => aliases.get(normalizeHeader(h)) ?? normalizeHeader(h),
    );
    const duplicateHeaders = headers.filter(
      (h, i) => h && headers.indexOf(h) !== i,
    );
    for (let i = 1; i < sheet.data.length; i++) {
      const cells = sheet.data[i];
      if (cells.every((c) => c === null || String(c).trim() === "")) continue;
      const values: Record<string, CatalogWorkbookCell> = {};
      const requestedOperation = String(
        cells[headers.indexOf("updateDelete")] ?? "",
      ).trim();
      const errors = duplicateHeaders.map((h) => `重复列：${h}`);
      if (
        headers.includes("updateDelete") &&
        !importOperations.includes(
          requestedOperation as (typeof importOperations)[number],
        )
      )
        errors.push("Update Delete：请选择 Update、PartialUpdate 或 Delete");
      headers.forEach((key, column) => {
        if (!key) return;
        if (
          requestedOperation === "Delete" &&
          !["sku", "adapterSku", "compatibilityId", "updateDelete"].includes(
            key,
          )
        )
          return;
        const raw = cells[column] ?? null;
        const field = [...fields].reverse().find((f) => f.key === key);
        const blank = raw === null || String(raw).trim() === "";
        const numeric = field?.kind === "number" || key === "amount";
        values[key] = blank
          ? null
          : numeric
            ? Number(raw)
            : typeof raw === "string"
              ? raw.trim()
              : raw;
        if (numeric && !blank && !Number.isFinite(Number(raw)))
          errors.push(`${key}：数值无效`);
        if (
          contract.fields.find((f) => f.key === key)?.required &&
          blank &&
          !splitTemplate &&
          !requestedOperation
        )
          errors.push(`${key}：已提供的必填列不能为空`);
      });
      if (requestedOperation === "PartialUpdate") {
        for (const key of Object.keys(values))
          if (values[key] === null) delete values[key];
      }
      if (
        splitTemplate &&
        prefix !== "04" &&
        requestedOperation !== "PartialUpdate" &&
        requestedOperation !== "Delete"
      ) {
        if (values.currency === null) delete values.currency;
        if (values.catalogPublicationStatus === null)
          delete values.catalogPublicationStatus;
        if (values.technicalDataStatus === null)
          values.technicalDataStatus = "Complete";
      }
      const source = { sheet: sheet.sheet, row: i + 1, values, cells };
      if (prefix === "04") {
        relations.push({
          id: crypto.randomUUID(),
          source,
          issues: [
            ...errors,
            ...(requestedOperation === "PartialUpdate" ||
            requestedOperation === "Delete"
              ? values.compatibilityId
                ? []
                : [{ field: "compatibilityId", message: "兼容编号必填" }]
              : validateCatalogWorksheetRecord(contract.name, values)
            ).map((f) => `${f.field}：${f.message}`),
          ],
        });
        continue;
      }
      records.push({ source, prefix, errors });
    }
  }
  async function proposal(
    type: CommercialProductType,
    kind: "series" | "sku",
    code: string,
  ) {
    const key = identity(type, kind, code);
    const existing = proposals.get(key);
    if (existing) return existing;
    const base = await input.baseline(type, kind, code);
    const owned: Record<string, CatalogWorkbookCell> = Object.fromEntries(
      productFields(type, kind).map((f) => [f.key, null]),
    );
    if (kind === "series") {
      owned.seriesCode = code;
      owned.seriesName = code;
    } else owned.sku = code;
    const payload = base
      ? structuredClone(base.payload)
      : ({
          kind,
          productType: type,
          [kind === "series" ? "series" : "variant"]: owned,
          [kind === "series" ? "commercialRule" : "price"]: null,
          mediaVersionId: null,
        } as unknown as CatalogItemPayload);
    const result: ImportProposal = {
      id: crypto.randomUUID(),
      command: {
        commandId: crypto.randomUUID(),
        actorId: input.actorId,
        ipAddress: input.ipAddress,
        payload,
        targetState: base?.state ?? "online",
        mode: base ? "edit" : "create",
        baselineRevisionId: base?.revisionId ?? null,
        source: { channel: "excel", batchId: input.batchId },
      },
      baseline: base?.payload ?? null,
      sources: [],
      issues: [],
      dependencies: [],
    };
    proposals.set(key, result);
    assignments.set(key, new Map());
    return result;
  }
  function patch(p: ImportProposal, path: string, value: unknown) {
    const key = identity(
      p.command.payload.productType,
      p.command.payload.kind,
      itemCode(p.command.payload),
    );
    const seen = assignments.get(key)!;
    if (seen.has(path) && seen.get(path) !== stable(value))
      p.issues.push(`重复条目字段冲突：${path}`);
    seen.set(path, stable(value));
    if (path === "targetState") {
      p.command.targetState = value as CatalogItemCommand["targetState"];
      return;
    }
    const parts = path.split(".");
    const payload = p.command.payload as unknown as Record<string, unknown>;
    if (parts.length === 1) payload[path] = value;
    else {
      const parent = (payload[parts[0]] ??=
        parts[0] === "commercialRule"
          ? Object.fromEntries(importRuleKeys.map((key) => [key, null]))
          : {}) as Record<string, unknown>;
      parent[parts[1]] = value;
    }
  }
  function attach(p: ImportProposal, source: ImportSource, errors: string[]) {
    p.sources.push(source);
    p.issues.push(...errors);
  }
  async function legacySeriesImage(
    parent: ImportProposal | null,
    values: Record<string, CatalogWorkbookCell>,
  ) {
    if (!parent || !("seriesMainImageReference" in values)) return;
    const reference = values.seriesMainImageReference;
    const id =
      reference === null
        ? null
        : input.resolveMediaReference
          ? await input.resolveMediaReference(String(reference))
          : String(reference).startsWith("media-version:")
            ? String(reference).slice(14)
            : null;
    if (reference !== null && !id) {
      parent.issues.push("系列图片引用不存在，请选择已保存的图片版本");
      return;
    }
    if ("seriesMediaVersionId" in values && values.seriesMediaVersionId !== id)
      parent.issues.push("系列图片引用与版本列冲突");
    patch(parent, "mediaVersionId", id);
  }
  function applyPrice(
    child: ImportProposal,
    v: Record<string, CatalogWorkbookCell>,
  ) {
    if (child.command.payload.kind !== "sku") return;
    const price = child.command.payload.price;
    const currency =
      "currency" in v ? String(v.currency ?? "") : (price?.currency ?? "USD");
    if (!itemCurrencies.includes(currency as (typeof itemCurrencies)[number]))
      child.issues.push("币种无效");
    if ("referencePriceUsd" in v && currency !== "USD")
      child.issues.push("USD 专用价格列只能使用 USD；请修正价格及币种");
    if (
      "referencePriceUsd" in v &&
      "amount" in v &&
      v.referencePriceUsd !== v.amount
    )
      child.issues.push("两种零售价格列冲突");
    if (!price)
      child.command.payload.price = {
        amount: null,
        currency: "USD",
        packageLengthFt: null,
      };
    if ("currency" in v || !price) patch(child, "price.currency", currency);
    if ("amount" in v || "referencePriceUsd" in v)
      patch(
        child,
        "price.amount",
        "amount" in v ? v.amount : (v.referencePriceUsd ?? null),
      );
    for (const key of ["packageLengthFt", ...packagingFields.map((f) => f.key)])
      if (key in v) patch(child, `price.${key}`, v[key]);
  }
  // Master data first, irrespective of workbook tab order, so offers can find newly imported parents.
  for (const { source, prefix, errors } of records.filter(
    (r) => r.prefix !== "07",
  )) {
    const type = worksheetTypes[prefix];
    const v = source.values;
    const sku = String(v.sku ?? v.adapterSku ?? "");
    if (!type || !sku) {
      issues.push(`${source.sheet}:${source.row} 缺少 SKU，原始行保留在批次中`);
      continue;
    }
    const child = await proposal(type, "sku", sku);
    attach(child, source, errors);
    const operation = String(v.updateDelete ?? "");
    if (
      importOperations.includes(operation as (typeof importOperations)[number])
    ) {
      const previous = child.command.source.importOperation;
      if (previous && previous !== operation)
        child.issues.push("同一 SKU 的 Update Delete 操作冲突");
      child.command.source.importOperation =
        operation as (typeof importOperations)[number];
      child.command.mode = operation === "Update" ? "create" : "edit";
      if (operation === "Update" && child.baseline)
        child.issues.push("Update 只能新增，SKU 已存在");
      if (operation !== "Update" && !child.baseline)
        child.issues.push(`${operation} 要求 SKU 已存在`);
      if (operation === "Delete") {
        child.command.source.operation = "delete";
        child.command.targetState = "discontinued";
        continue;
      }
    }
    if (
      "updateDelete" in v &&
      !importOperations.includes(operation as (typeof importOperations)[number])
    )
      child.command.source.importOperation =
        operation as (typeof importOperations)[number];
    const current = ownedProductValues(child.command.payload);
    const seriesCode = String(
      v[importSeriesKeys[type]] ??
        v.seriesCode ??
        current[importSeriesKeys[type]] ??
        "",
    );
    if (!seriesCode) child.issues.push("缺少所属系列");
    const parent = seriesCode
      ? await proposal(type, "series", seriesCode)
      : null;
    if (parent)
      attach(
        parent,
        source,
        errors.filter((error) =>
          productFields(type, "series").some((f) =>
            error.startsWith(`${f.key}：`),
          ),
        ),
      );
    for (const f of productFields(type, "sku")) {
      const sourceKey =
        f.key === "sku" && "adapterSku" in v ? "adapterSku" : f.key;
      if (sourceKey in v) patch(child, `variant.${f.key}`, v[sourceKey]);
    }
    if (integratedPriceFields.some((f) => f.key in v)) applyPrice(child, v);
    if (seriesCode)
      patch(child, `variant.${importSeriesKeys[type]}`, seriesCode);
    if (parent)
      for (const f of productFields(type, "series")) {
        const sourceKey =
          f.key === "interfaceStandard" && !(f.key in v)
            ? "connectionStandard"
            : f.key;
        if (
          f.key !== "seriesCode" &&
          sourceKey in v &&
          !(operation === "Update" && parent.baseline && v[sourceKey] === null)
        )
          patch(parent, `series.${f.key}`, v[sourceKey]);
      }
    if ("catalogPublicationStatus" in v) {
      const target = state(v.catalogPublicationStatus);
      if (!target) child.issues.push("产品状态无效");
      else patch(child, "targetState", target);
    }
    if ("mediaVersionId" in v) patch(child, "mediaVersionId", v.mediaVersionId);
    await legacySeriesImage(parent, v);
    if (
      parent &&
      "seriesMediaVersionId" in v &&
      !(
        String(v.updateDelete) === "Update" &&
        parent.baseline &&
        v.seriesMediaVersionId === null
      )
    )
      patch(parent, "mediaVersionId", v.seriesMediaVersionId);
  }
  for (const { source, errors } of records.filter((r) => r.prefix === "07")) {
    const v = source.values;
    const sku = String(v.baseSku ?? "");
    let type =
      offerTypes[String(v.productType)] ??
      Object.values(worksheetTypes).find((t) =>
        proposals.has(identity(t, "sku", sku)),
      );
    if (!type && !("productType" in v) && sku) {
      for (const candidate of Object.values(worksheetTypes))
        if (await input.baseline(candidate, "sku", sku)) {
          type = candidate;
          break;
        }
    }
    if (!type || !sku) {
      issues.push(
        `${source.sheet}:${source.row} 缺少或无法识别 Product Type / Base SKU`,
      );
      continue;
    }
    const child = await proposal(type, "sku", sku);
    attach(child, source, errors);
    const seriesCode = String(
      ownedProductValues(child.command.payload)[importSeriesKeys[type]] ??
        v.seriesCode ??
        "",
    );
    const parent = seriesCode
      ? await proposal(type, "series", seriesCode)
      : null;
    if (!parent) child.issues.push("价格行找不到所属系列");
    if (parent)
      attach(
        parent,
        source,
        errors.filter((error) =>
          importRuleKeys.some((key) => error.startsWith(`${key}：`)),
        ),
      );
    applyPrice(child, v);
    if (parent)
      for (const key of importRuleKeys)
        if (key in v) {
          patch(parent, "commercialRule.productType", type);
          patch(parent, "commercialRule.seriesCode", seriesCode);
          patch(parent, `commercialRule.${key}`, v[key]);
        }
    if ("catalogPublicationStatus" in v) {
      const target = state(v.catalogPublicationStatus);
      if (target) patch(child, "targetState", target);
      else child.issues.push("产品状态无效");
    }
    if ("mediaVersionId" in v) patch(child, "mediaVersionId", v.mediaVersionId);
    await legacySeriesImage(parent, v);
    if (
      parent &&
      "seriesMediaVersionId" in v &&
      !(
        String(v.updateDelete) === "Update" &&
        parent.baseline &&
        v.seriesMediaVersionId === null
      )
    )
      patch(parent, "mediaVersionId", v.seriesMediaVersionId);
  }
  for (const p of proposals.values())
    if (p.command.payload.kind === "sku") {
      if (
        [...proposals.values()].some(
          (other) =>
            other.command.payload.kind === "sku" &&
            other.command.payload.productType !==
              p.command.payload.productType &&
            itemCode(other.command.payload) === itemCode(p.command.payload),
        )
      )
        p.issues.push("同一 SKU 在不同产品类型中重复");
    }
  const requests: ImportProposal[] = [];
  for (const p of proposals.values()) {
    if (splitTemplate && p.command.source.operation !== "delete") {
      const values = ownedProductValues(p.command.payload);
      for (const f of productFields(
        p.command.payload.productType,
        p.command.payload.kind,
      )) {
        if (
          f.required &&
          (values[f.key] == null || String(values[f.key]).trim() === "")
        )
          p.issues.push(`${f.key}：必填项不能为空（与手动新增一致）`);
      }
    }
    p.issues = [...new Set(p.issues)];
    const base = await input.baseline(
      p.command.payload.productType,
      p.command.payload.kind,
      itemCode(p.command.payload),
    );
    if (
      base &&
      p.command.source.operation !== "delete" &&
      !p.issues.length &&
      stable(comparable(base.payload)) ===
        stable(comparable(p.command.payload)) &&
      base.state === p.command.targetState
    )
      continue;
    requests.push(p);
  }
  for (const p of requests)
    if (
      p.command.payload.kind === "sku" &&
      p.command.source.operation !== "delete"
    ) {
      const payload = p.command.payload;
      const code = String(
        ownedProductValues(payload)[importSeriesKeys[payload.productType]] ??
          "",
      );
      const base = await input.baseline(payload.productType, "series", code);
      const parent = requests.find(
        (r) =>
          r.command.payload.kind === "series" &&
          r.command.payload.productType === payload.productType &&
          itemCode(r.command.payload) === code,
      );
      if (parent && (!base || base.state !== "online"))
        p.dependencies.push(parent.id);
      // Conflicts in shared data invalidate related rows, even if an older parent is already online.
      if (parent?.issues.length)
        p.issues.push("相关系列数据有错误，需一并修正后审核");
    }
  return { requests, relations, issues };
}
