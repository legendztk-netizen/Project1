import {
  hoseEndMediaKeyFromMainImageReference,
  isUploadedMainImageReference,
} from "./catalog-main-image";
import {
  productLifecycleState,
  type ProductLifecycleStatus,
} from "./catalog-product-lifecycle";
import type {
  CatalogImportValidationResult,
  CatalogSkuDraft,
  TechnicalDataStatus,
} from "./catalog-workbook";

export interface HoseEndSeriesRecord {
  angle: string;
  gender: string;
  interfaceFamily: string;
  interfaceStandard: string;
  representativeImageReference: string;
  sealingForm: string;
  seriesCode: string;
  seriesName: string;
  swivelForm: string;
}

export interface HoseEndVariantInput {
  coating: string;
  competitorPartNumber: string | null;
  connectionDash: string;
  cutoffBMm: number;
  dimensionAMm: number;
  drawingNumber: string | null;
  drawingRevision: string | null;
  fittingSeries: string;
  hex1Mm: number;
  hex2Mm: number;
  hoseTailDash: string;
  material: string;
  maxWorkingBar: number;
  minimumBoreMm: number;
  notes: string;
  saltSprayHours: number;
  sku: string;
  source: string | null;
  technicalDataStatus: TechnicalDataStatus | null;
  thread: string;
  unitWeightG: number;
}

export interface HoseEndVariantRecord extends HoseEndVariantInput {
  imageOverrideReference: string | null;
  lifecycleStatus: ProductLifecycleStatus;
}

interface DraftOperationIdentity {
  actorId: string;
  auditEventId: string;
  draftImportId: string;
  draftReleaseId: string;
  draftReleaseNumber: string;
  occurredAt: string;
}

export interface SaveHoseEndSeriesOperation extends DraftOperationIdentity {
  mode: "create" | "edit";
  originalSeriesCode: string | null;
  series: HoseEndSeriesRecord;
  seriesId: string;
}

export interface SaveHoseEndVariantOperation extends DraftOperationIdentity {
  imageOverrideReference: string | null;
  lifecycle: ReturnType<typeof productLifecycleState>;
  mediaAssignmentId: string;
  mode: "create" | "edit";
  originalSku: string | null;
  series: HoseEndSeriesRecord;
  skuId: string;
  variant: HoseEndVariantInput;
  variantId: string;
}

export interface CatalogHoseEndMaintenanceRepository {
  findHoseEndSeries(seriesCode: string): Promise<HoseEndSeriesRecord | null>;
  findHoseEndVariant(sku: string): Promise<HoseEndVariantRecord | null>;
  findProductIdentity(sku: string): Promise<{
    productType: CatalogSkuDraft["productType"];
    sku: string;
  } | null>;
  listHoseEndSeries(): Promise<HoseEndSeriesRecord[]>;
  saveHoseEndSeries(operation: SaveHoseEndSeriesOperation): Promise<{
    draftReleaseId: string;
    mode: "created" | "updated";
    seriesCode: string;
  }>;
  saveHoseEndVariant(operation: SaveHoseEndVariantOperation): Promise<{
    draftReleaseId: string;
    mode: "created" | "updated";
    sku: string;
  }>;
}

export class HoseEndMaintenanceRejected extends Error {
  constructor(
    message: string,
    readonly findings: CatalogImportValidationResult[] = [],
  ) {
    super(message);
    this.name = "HoseEndMaintenanceRejected";
  }
}

export interface MaintainHoseEndSeriesInput {
  actorId: string;
  generateId?: () => string;
  mode: "create" | "edit";
  now?: () => Date;
  originalSeriesCode: string | null;
  series: HoseEndSeriesRecord;
}

export interface MaintainHoseEndVariantInput {
  actorId: string;
  generateId?: () => string;
  imageOverrideReference: string | null;
  lifecycleStatus: ProductLifecycleStatus;
  mode: "create" | "edit";
  now?: () => Date;
  originalSku: string | null;
  variant: HoseEndVariantInput;
}

function normalizedCode(value: string) {
  return value.trim().toUpperCase();
}

function normalizedText(value: string | null | undefined) {
  return value?.trim() || null;
}

function finding(
  field: string,
  code: string,
  message: string,
  sku: string | null = null,
): CatalogImportValidationResult {
  return {
    code,
    field,
    message,
    row: 0,
    severity: "error",
    sku,
    worksheet: "02_压接接头",
  };
}

function requiredText(
  findings: CatalogImportValidationResult[],
  value: string | null | undefined,
  field: string,
  sku: string | null = null,
) {
  if (!normalizedText(value)) {
    findings.push(
      finding(
        field,
        "required",
        `${field} is required / ${field}为必填项`,
        sku,
      ),
    );
  }
}

function requiredPositiveNumber(
  findings: CatalogImportValidationResult[],
  value: number,
  field: string,
  sku: string,
) {
  if (!Number.isFinite(value) || value <= 0) {
    findings.push(
      finding(
        field,
        "invalid_number",
        `${field} must be greater than zero / ${field}必须大于零`,
        sku,
      ),
    );
  }
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

export async function validateHoseEndSeriesMaintenance(
  repository: CatalogHoseEndMaintenanceRepository,
  input: MaintainHoseEndSeriesInput,
) {
  const series: HoseEndSeriesRecord = {
    angle: input.series.angle.trim(),
    gender: input.series.gender.trim(),
    interfaceFamily: input.series.interfaceFamily.trim(),
    interfaceStandard: input.series.interfaceStandard.trim(),
    representativeImageReference:
      input.series.representativeImageReference.trim(),
    sealingForm: input.series.sealingForm.trim(),
    seriesCode: normalizedCode(input.series.seriesCode),
    seriesName: input.series.seriesName.trim(),
    swivelForm: input.series.swivelForm.trim(),
  };
  const findings: CatalogImportValidationResult[] = [];
  for (const [value, field] of [
    [series.seriesCode, "Series Code / 系列编号"],
    [series.seriesName, "Series Name / 系列名称"],
    [series.interfaceFamily, "Interface Family / 接口体系"],
    [series.interfaceStandard, "Interface Standard / 接口标准"],
    [series.gender, "Gender / 公母"],
    [series.swivelForm, "Swivel/Fixed / 旋转或固定"],
    [series.angle, "Angle / 角度"],
    [series.sealingForm, "Sealing Form / 密封形式"],
  ] as const) {
    requiredText(findings, value, field);
  }
  if (
    !isUploadedMainImageReference(series.representativeImageReference) &&
    !hoseEndMediaKeyFromMainImageReference(series.representativeImageReference)
  ) {
    findings.push(
      finding(
        "Representative Image / 系列代表图",
        "invalid_series_image",
        "Choose a reviewed image or upload an image / 请选择已审核图片或上传图片",
      ),
    );
  }
  if (
    input.mode === "edit" &&
    normalizedCode(input.originalSeriesCode ?? "") !== series.seriesCode
  ) {
    throw new HoseEndMaintenanceRejected(
      "Series Code cannot be changed / 系列编号不可修改",
    );
  }
  if (findings.length > 0) {
    throw new HoseEndMaintenanceRejected(
      "Hose End Series was not saved / 压接接头系列未保存",
      findings,
    );
  }
  const existing = await repository.findHoseEndSeries(series.seriesCode);
  if (input.mode === "create" && existing) {
    throw new HoseEndMaintenanceRejected(
      "Series Code already exists; open it for editing / 系列编号已存在，请打开后编辑",
    );
  }
  if (input.mode === "edit" && !existing) {
    throw new HoseEndMaintenanceRejected(
      "Hose End Series was not found / 未找到压接接头系列",
    );
  }
  return series;
}

export async function maintainHoseEndSeries(
  repository: CatalogHoseEndMaintenanceRepository,
  input: MaintainHoseEndSeriesInput,
) {
  const series = await validateHoseEndSeriesMaintenance(repository, input);
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  return repository.saveHoseEndSeries({
    ...operationIdentity(
      input.actorId,
      generateId,
      input.now ?? (() => new Date()),
    ),
    mode: input.mode,
    originalSeriesCode: input.originalSeriesCode,
    series,
    seriesId: generateId(),
  });
}

export async function validateHoseEndVariantMaintenance(
  repository: CatalogHoseEndMaintenanceRepository,
  input: MaintainHoseEndVariantInput,
) {
  const variant: HoseEndVariantInput = {
    ...input.variant,
    coating: input.variant.coating.trim(),
    competitorPartNumber: normalizedText(input.variant.competitorPartNumber),
    connectionDash: input.variant.connectionDash.trim(),
    drawingNumber: normalizedText(input.variant.drawingNumber),
    drawingRevision: normalizedText(input.variant.drawingRevision),
    fittingSeries: normalizedCode(input.variant.fittingSeries),
    hoseTailDash: input.variant.hoseTailDash.trim(),
    material: input.variant.material.trim(),
    notes: input.variant.notes.trim(),
    sku: normalizedCode(input.variant.sku),
    source: normalizedText(input.variant.source),
    thread: input.variant.thread.trim(),
  };
  const findings: CatalogImportValidationResult[] = [];
  for (const [value, field] of [
    [variant.fittingSeries, "Fitting Series / 接头系列"],
    [variant.sku, "Hose End SKU / 接头SKU"],
    [variant.thread, "Thread / 螺纹"],
    [variant.connectionDash, "Connection Dash / 接口Dash"],
    [variant.hoseTailDash, "Hose Tail Dash / 胶管尾Dash"],
    [variant.material, "Material / 材质"],
    [variant.coating, "Coating / 表面处理"],
    [variant.notes, "Notes / 备注"],
  ] as const) {
    requiredText(findings, value, field, variant.sku);
  }
  for (const [value, field] of [
    [variant.saltSprayHours, "Salt Spray h / 盐雾小时"],
    [variant.maxWorkingBar, "Max Working bar / 最大工作压力"],
    [variant.dimensionAMm, "Dimension A mm / 总长A"],
    [variant.cutoffBMm, "Cut-off B mm / 扣除量B"],
    [variant.hex1Mm, "Hex 1 mm / 六角1"],
    [variant.hex2Mm, "Hex 2 mm / 六角2"],
    [variant.minimumBoreMm, "Minimum Bore mm / 最小通径"],
    [variant.unitWeightG, "Unit Weight g / 单重"],
  ] as const) {
    requiredPositiveNumber(findings, value, field, variant.sku);
  }
  const override = normalizedText(input.imageOverrideReference);
  if (
    override &&
    !isUploadedMainImageReference(override) &&
    !hoseEndMediaKeyFromMainImageReference(override)
  ) {
    findings.push(
      finding(
        "Variant Image Override / 子体图片覆盖",
        "invalid_image_override",
        "Choose a reviewed image or upload an image / 请选择已审核图片或上传图片",
        variant.sku,
      ),
    );
  }
  if (
    input.mode === "edit" &&
    normalizedCode(input.originalSku ?? "") !== variant.sku
  ) {
    findings.push(
      finding(
        "Hose End SKU / 接头SKU",
        "sku_immutable",
        "Hose End SKU cannot be changed / 接头SKU不可修改",
        variant.sku,
      ),
    );
  }
  if (findings.length > 0) {
    throw new HoseEndMaintenanceRejected(
      "Hose End Variant was not saved / 压接接头子体未保存",
      findings,
    );
  }
  const series = await repository.findHoseEndSeries(variant.fittingSeries);
  if (!series) {
    throw new HoseEndMaintenanceRejected(
      "Select an existing Hose End Series / 请选择已有压接接头系列",
      [
        finding(
          "Fitting Series / 接头系列",
          "series_not_found",
          "Selected Hose End Series does not exist / 所选压接接头系列不存在",
          variant.sku,
        ),
      ],
    );
  }
  const existing = await repository.findProductIdentity(variant.sku);
  if (input.mode === "create" && existing) {
    throw new HoseEndMaintenanceRejected(
      "Hose End SKU already exists; open it for editing / 接头SKU已存在，请打开后编辑",
    );
  }
  if (
    input.mode === "edit" &&
    (!existing || existing.productType !== "hose_end")
  ) {
    throw new HoseEndMaintenanceRejected(
      "Hose End Variant was not found / 未找到压接接头子体",
    );
  }
  return { imageOverrideReference: override, series, variant };
}

export async function maintainHoseEndVariant(
  repository: CatalogHoseEndMaintenanceRepository,
  input: MaintainHoseEndVariantInput,
) {
  const validated = await validateHoseEndVariantMaintenance(repository, input);
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  return repository.saveHoseEndVariant({
    ...operationIdentity(
      input.actorId,
      generateId,
      input.now ?? (() => new Date()),
    ),
    imageOverrideReference: validated.imageOverrideReference,
    lifecycle: productLifecycleState(input.lifecycleStatus),
    mediaAssignmentId: generateId(),
    mode: input.mode,
    originalSku: input.originalSku,
    series: validated.series,
    skuId: generateId(),
    variant: validated.variant,
    variantId: generateId(),
  });
}
