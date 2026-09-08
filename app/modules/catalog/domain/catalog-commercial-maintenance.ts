import type { ProductLifecycleStatus } from "./catalog-product-lifecycle";

export const commercialProductTypes = [
  "hose",
  "hose_end",
  "ferrule",
  "adapter",
  "quick_coupler",
] as const;

export type CommercialProductType = (typeof commercialProductTypes)[number];

export interface CatalogSeriesOption {
  productType: CommercialProductType;
  seriesCode: string;
  seriesName: string;
}

export interface SeriesCommercialRule {
  continuousLengthConfirmation: string | null;
  countryOfOrigin: string;
  hsCode: string | null;
  leadTimeDays: number;
  lengthIncrementFt: number | null;
  minimumLengthPerPieceFt: number | null;
  moq: number;
  notes: string | null;
  presetLength1Ft: number | null;
  presetLength2Ft: number | null;
  presetLength3Ft: number | null;
  productType: CommercialProductType;
  quantityInputMode: string;
  salesUnit: string;
  seriesCode: string;
}

export interface SkuPricePackaging {
  cartonGrossWeightKg: number | null;
  cartonHCm: number | null;
  cartonLCm: number | null;
  cartonWCm: number | null;
  currency: "USD";
  innerPackQty: number | null;
  masterCartonQty: number | null;
  netUnitWeightKg: number | null;
  packageLengthFt: number | null;
  packingBasis: string | null;
  referencePrice: number | null;
  salesSku: string;
  sku: string;
  unitsPerSalesPack: number | null;
}

export interface CommercialSkuRecord {
  lifecycleStatus: ProductLifecycleStatus;
  productType: CommercialProductType;
  seriesCode: string;
  sku: string;
}

interface DraftOperationIdentity {
  actorId: string;
  auditEventId: string;
  draftImportId: string;
  draftReleaseId: string;
  draftReleaseNumber: string;
  occurredAt: string;
}

export interface SaveSeriesCommercialRuleOperation extends DraftOperationIdentity {
  ipAddress: string;
  requestCorrelationId: string;
  rule: SeriesCommercialRule;
  ruleId: string;
}

export interface SaveSkuPricePackagingOperation extends DraftOperationIdentity {
  ipAddress: string;
  packaging: SkuPricePackaging;
  pricePackagingId: string;
  requestCorrelationId: string;
  skuRecord: CommercialSkuRecord;
}

export interface CatalogCommercialMaintenanceRepository {
  findSeries(
    productType: CommercialProductType,
    seriesCode: string,
  ): Promise<CatalogSeriesOption | null>;
  findSeriesRule(
    productType: CommercialProductType,
    seriesCode: string,
  ): Promise<SeriesCommercialRule | null>;
  findSku(sku: string): Promise<CommercialSkuRecord | null>;
  findSkuPricePackaging(sku: string): Promise<SkuPricePackaging | null>;
  listSeries(
    productType: CommercialProductType,
  ): Promise<CatalogSeriesOption[]>;
  saveSeriesRule(
    operation: SaveSeriesCommercialRuleOperation,
  ): Promise<{ draftReleaseId: string }>;
  saveSkuPricePackaging(
    operation: SaveSkuPricePackagingOperation,
  ): Promise<{ draftReleaseId: string }>;
}

export class CatalogCommercialMaintenanceRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogCommercialMaintenanceRejected";
  }
}

function normalizedCode(value: string) {
  return value.trim().toUpperCase();
}

function normalizedText(value: string | null | undefined) {
  return value?.trim() || null;
}

function optionalNumber(value: number | null, label: string) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new CatalogCommercialMaintenanceRejected(
      `${label} must be a non-negative number / ${label}必须为非负数`,
    );
  }
  return value;
}

function requiredNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new CatalogCommercialMaintenanceRejected(
      `${label} must be a non-negative number / ${label}必须为非负数`,
    );
  }
  return value;
}

function requiredText(value: string, label: string) {
  const normalized = normalizedText(value);
  if (!normalized) {
    throw new CatalogCommercialMaintenanceRejected(
      `${label} is required / ${label}为必填项`,
    );
  }
  return normalized;
}

function operationIdentity(
  actorId: string,
  generateId: () => string,
  now: () => Date,
): DraftOperationIdentity {
  const occurredAt = now().toISOString();
  const draftReleaseId = generateId();
  const timestamp = occurredAt.replaceAll(/[-:.]/gu, "").slice(0, 15);
  return {
    actorId,
    auditEventId: generateId(),
    draftImportId: generateId(),
    draftReleaseId,
    draftReleaseNumber: `DRAFT-${timestamp}-${draftReleaseId.replaceAll("-", "").slice(-8).toUpperCase()}`,
    occurredAt,
  };
}

export function normalizeSeriesCommercialRule(
  rule: SeriesCommercialRule,
): SeriesCommercialRule {
  return {
    continuousLengthConfirmation: normalizedText(
      rule.continuousLengthConfirmation,
    ),
    countryOfOrigin: requiredText(
      rule.countryOfOrigin,
      "Country of Origin / 原产国",
    ),
    hsCode: normalizedText(rule.hsCode),
    leadTimeDays: requiredNumber(
      rule.leadTimeDays,
      "Lead Time days / 交期天数",
    ),
    lengthIncrementFt: optionalNumber(
      rule.lengthIncrementFt,
      "Length Increment ft / 长度步长",
    ),
    minimumLengthPerPieceFt: optionalNumber(
      rule.minimumLengthPerPieceFt,
      "Minimum Length per Piece ft / 每根最小长度",
    ),
    moq: requiredNumber(rule.moq, "MOQ / 最小起订量"),
    notes: normalizedText(rule.notes),
    presetLength1Ft: optionalNumber(
      rule.presetLength1Ft,
      "Preset Length 1 ft / 快捷长度1",
    ),
    presetLength2Ft: optionalNumber(
      rule.presetLength2Ft,
      "Preset Length 2 ft / 快捷长度2",
    ),
    presetLength3Ft: optionalNumber(
      rule.presetLength3Ft,
      "Preset Length 3 ft / 快捷长度3",
    ),
    productType: rule.productType,
    quantityInputMode: requiredText(
      rule.quantityInputMode,
      "Quantity Input Mode / 数量输入方式",
    ),
    salesUnit: requiredText(rule.salesUnit, "Sales Unit / 销售单位"),
    seriesCode: requiredText(rule.seriesCode, "Series / 系列"),
  };
}

function normalizePackaging(
  sku: string,
  packaging: SkuPricePackaging,
): SkuPricePackaging {
  if (packaging.currency !== "USD") {
    throw new CatalogCommercialMaintenanceRejected(
      "Currency must be USD / 币种首期固定为美元 USD",
    );
  }
  return {
    cartonGrossWeightKg: optionalNumber(
      packaging.cartonGrossWeightKg,
      "Carton Gross Weight kg / 整箱毛重",
    ),
    cartonHCm: optionalNumber(packaging.cartonHCm, "Carton H cm / 箱高"),
    cartonLCm: optionalNumber(packaging.cartonLCm, "Carton L cm / 箱长"),
    cartonWCm: optionalNumber(packaging.cartonWCm, "Carton W cm / 箱宽"),
    currency: "USD",
    innerPackQty: optionalNumber(
      packaging.innerPackQty,
      "Inner Pack Qty / 内包装数量",
    ),
    masterCartonQty: optionalNumber(
      packaging.masterCartonQty,
      "Master Carton Qty / 每外箱数量",
    ),
    netUnitWeightKg: optionalNumber(
      packaging.netUnitWeightKg,
      "Net Unit Weight kg / 单个销售单位净重",
    ),
    packageLengthFt: optionalNumber(
      packaging.packageLengthFt,
      "Package Length ft / 包装长度",
    ),
    packingBasis: normalizedText(packaging.packingBasis),
    referencePrice: optionalNumber(
      packaging.referencePrice,
      "Retail Unit Price / 零售单价",
    ),
    salesSku: sku,
    sku,
    unitsPerSalesPack: optionalNumber(
      packaging.unitsPerSalesPack,
      "Units per Sales Pack / 每销售包装数量",
    ),
  };
}

export async function maintainSeriesCommercialRule(
  repository: CatalogCommercialMaintenanceRepository,
  input: {
    actorId: string;
    generateId?: () => string;
    ipAddress?: string;
    now?: () => Date;
    requestCorrelationId?: string;
    rule: SeriesCommercialRule;
  },
) {
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date());
  const normalizedRule = normalizeSeriesCommercialRule(input.rule);
  const series = await repository.findSeries(
    normalizedRule.productType,
    normalizedRule.seriesCode,
  );
  if (!series) {
    throw new CatalogCommercialMaintenanceRejected(
      "Series does not exist / 系列不存在",
    );
  }
  const rule = { ...normalizedRule, seriesCode: series.seriesCode };
  const identity = operationIdentity(input.actorId, generateId, now);
  return repository.saveSeriesRule({
    ...identity,
    ipAddress: input.ipAddress ?? "local",
    requestCorrelationId: input.requestCorrelationId ?? identity.auditEventId,
    rule,
    ruleId: generateId(),
  });
}

export async function maintainSkuPricePackaging(
  repository: CatalogCommercialMaintenanceRepository,
  input: {
    actorId: string;
    generateId?: () => string;
    ipAddress?: string;
    now?: () => Date;
    packaging: SkuPricePackaging;
    requestCorrelationId?: string;
    sku: string;
  },
) {
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date());
  const sku = normalizedCode(input.sku);
  const skuRecord = await repository.findSku(sku);
  if (!skuRecord) {
    throw new CatalogCommercialMaintenanceRejected(
      "Product SKU does not exist / 产品 SKU 不存在",
    );
  }
  if (
    !(await repository.findSeriesRule(
      skuRecord.productType,
      skuRecord.seriesCode,
    ))
  ) {
    throw new CatalogCommercialMaintenanceRejected(
      "Save the Series Commercial Rule first / 请先保存系列销售、包装和价格规则",
    );
  }
  const packaging = normalizePackaging(sku, input.packaging);
  const identity = operationIdentity(input.actorId, generateId, now);
  return repository.saveSkuPricePackaging({
    ...identity,
    ipAddress: input.ipAddress ?? "local",
    packaging,
    pricePackagingId: generateId(),
    requestCorrelationId: input.requestCorrelationId ?? identity.auditEventId,
    skuRecord,
  });
}

export function resolveEffectiveCommercialData(
  rule: SeriesCommercialRule,
  packaging: SkuPricePackaging,
) {
  return { ...rule, ...packaging };
}
