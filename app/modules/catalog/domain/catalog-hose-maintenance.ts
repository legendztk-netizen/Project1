import {
  hoseSeriesFromMainImageReference,
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

export interface HoseSeriesRecord {
  coverColor: string | null;
  coverFinish: string | null;
  coverMaterial: string | null;
  equivalentStandard: string;
  fluidCompatibility: string | null;
  primaryStandard: string;
  reinforcement: string | null;
  representativeImageReference: string;
  seriesCode: string;
  seriesName: string;
  tempMaxC: number;
  tempMinC: number;
  tubeMaterial: string | null;
}

export interface HoseVariantInput {
  bendRadiusMm: number;
  burstBar: number;
  dash: string;
  hoseSeries: string;
  idMm: number;
  mshaMarking: string | null;
  nominalIdIn: number;
  notes: string;
  odMm: number;
  skiveRequirement: string | null;
  sku: string;
  source: string | null;
  technicalDataStatus: TechnicalDataStatus | null;
  weightKgM: number;
  workingBar: number;
  workingPsi: number;
}

export interface HoseVariantRecord extends HoseVariantInput {
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

export interface SaveHoseSeriesOperation extends DraftOperationIdentity {
  mode: "create" | "edit";
  originalSeriesCode: string | null;
  series: HoseSeriesRecord;
  seriesId: string;
}

export interface SaveHoseVariantOperation extends DraftOperationIdentity {
  imageOverrideReference: string | null;
  lifecycle: ReturnType<typeof productLifecycleState>;
  mediaAssignmentId: string;
  mode: "create" | "edit";
  originalSku: string | null;
  series: HoseSeriesRecord;
  skuId: string;
  variant: HoseVariantInput;
  variantId: string;
}

export interface CatalogHoseMaintenanceRepository {
  findHoseSeries(seriesCode: string): Promise<HoseSeriesRecord | null>;
  findHoseVariant(sku: string): Promise<HoseVariantRecord | null>;
  findProductIdentity(sku: string): Promise<{
    productType: CatalogSkuDraft["productType"];
    sku: string;
  } | null>;
  listHoseSeries(): Promise<HoseSeriesRecord[]>;
  saveHoseSeries(operation: SaveHoseSeriesOperation): Promise<{
    draftReleaseId: string;
    mode: "created" | "updated";
    seriesCode: string;
  }>;
  saveHoseVariant(operation: SaveHoseVariantOperation): Promise<{
    draftReleaseId: string;
    mode: "created" | "updated";
    sku: string;
  }>;
}

export class HoseMaintenanceRejected extends Error {
  constructor(
    message: string,
    readonly findings: CatalogImportValidationResult[] = [],
  ) {
    super(message);
    this.name = "HoseMaintenanceRejected";
  }
}

export interface MaintainHoseSeriesInput {
  actorId: string;
  generateId?: () => string;
  mode: "create" | "edit";
  now?: () => Date;
  originalSeriesCode: string | null;
  series: HoseSeriesRecord;
}

export interface MaintainHoseVariantInput {
  actorId: string;
  generateId?: () => string;
  imageOverrideReference: string | null;
  lifecycleStatus: ProductLifecycleStatus;
  mode: "create" | "edit";
  now?: () => Date;
  originalSku: string | null;
  variant: HoseVariantInput;
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
    worksheet: "01_胶管主数据",
  };
}

function requiredText(
  findings: CatalogImportValidationResult[],
  value: string | null | undefined,
  field: string,
) {
  if (!normalizedText(value)) {
    findings.push(
      finding(field, "required", `${field} is required / ${field}为必填项`),
    );
  }
}

function requiredNumber(
  findings: CatalogImportValidationResult[],
  value: number,
  field: string,
  positive = false,
) {
  if (!Number.isFinite(value) || (positive && value <= 0)) {
    findings.push(
      finding(
        field,
        "invalid_number",
        `${field} must be ${positive ? "greater than zero" : "a valid number"} / ${field}必须${positive ? "大于零" : "为有效数字"}`,
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

export async function validateHoseSeriesMaintenance(
  repository: Pick<CatalogHoseMaintenanceRepository, "findHoseSeries">,
  input: MaintainHoseSeriesInput,
) {
  const series: HoseSeriesRecord = {
    ...input.series,
    coverColor: normalizedText(input.series.coverColor),
    coverFinish: normalizedText(input.series.coverFinish),
    coverMaterial: normalizedText(input.series.coverMaterial),
    equivalentStandard: input.series.equivalentStandard.trim(),
    fluidCompatibility: normalizedText(input.series.fluidCompatibility),
    primaryStandard: input.series.primaryStandard.trim(),
    reinforcement: normalizedText(input.series.reinforcement),
    representativeImageReference:
      input.series.representativeImageReference.trim(),
    seriesCode: normalizedCode(input.series.seriesCode),
    seriesName: input.series.seriesName.trim(),
    tubeMaterial: normalizedText(input.series.tubeMaterial),
  };
  const findings: CatalogImportValidationResult[] = [];
  for (const [value, field] of [
    [series.seriesCode, "Series Code / 系列编号"],
    [series.seriesName, "Series Name / 系列名称"],
    [series.primaryStandard, "Primary Standard / 主标准"],
    [series.equivalentStandard, "Equivalent Standard / 等效标准"],
  ] as const) {
    requiredText(findings, value, field);
  }
  requiredNumber(findings, series.tempMinC, "Temp Min °C / 最低温度");
  requiredNumber(findings, series.tempMaxC, "Temp Max °C / 最高温度");
  if (
    Number.isFinite(series.tempMinC) &&
    Number.isFinite(series.tempMaxC) &&
    series.tempMinC >= series.tempMaxC
  ) {
    findings.push(
      finding(
        "Temperature Range / 温度范围",
        "invalid_range",
        "Minimum temperature must be below maximum temperature / 最低温度必须低于最高温度",
      ),
    );
  }
  const reviewedSeries = hoseSeriesFromMainImageReference(
    series.representativeImageReference,
  );
  if (
    !isUploadedMainImageReference(series.representativeImageReference) &&
    reviewedSeries !== series.seriesCode
  ) {
    findings.push(
      finding(
        "Representative Image / 系列代表图",
        "invalid_series_image",
        "Choose this series' reviewed image or upload an image / 请选择本系列已审核图片或上传图片",
      ),
    );
  }
  if (
    input.mode === "edit" &&
    normalizedCode(input.originalSeriesCode ?? "") !== series.seriesCode
  ) {
    throw new HoseMaintenanceRejected(
      "Series Code cannot be changed / 系列编号不可修改",
    );
  }
  if (findings.length > 0) {
    throw new HoseMaintenanceRejected(
      "Hose Series was not saved / 胶管系列未保存",
      findings,
    );
  }
  const existing = await repository.findHoseSeries(series.seriesCode);
  if (input.mode === "create" && existing) {
    throw new HoseMaintenanceRejected(
      "Series Code already exists; open it for editing / 系列编号已存在，请打开后编辑",
    );
  }
  if (input.mode === "edit" && !existing) {
    throw new HoseMaintenanceRejected(
      "Hose Series was not found / 未找到胶管系列",
    );
  }
  return series;
}

export async function maintainHoseSeries(
  repository: CatalogHoseMaintenanceRepository,
  input: MaintainHoseSeriesInput,
) {
  const series = await validateHoseSeriesMaintenance(repository, input);
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  return repository.saveHoseSeries({
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

export async function validateHoseVariantMaintenance(
  repository: Pick<
    CatalogHoseMaintenanceRepository,
    "findHoseSeries" | "findProductIdentity"
  >,
  input: MaintainHoseVariantInput,
) {
  const variant: HoseVariantInput = {
    ...input.variant,
    dash: input.variant.dash.trim(),
    hoseSeries: normalizedCode(input.variant.hoseSeries),
    mshaMarking: normalizedText(input.variant.mshaMarking),
    notes: input.variant.notes.trim(),
    skiveRequirement: normalizedText(input.variant.skiveRequirement),
    sku: normalizedCode(input.variant.sku),
    source: normalizedText(input.variant.source),
  };
  const findings: CatalogImportValidationResult[] = [];
  for (const [value, field] of [
    [variant.hoseSeries, "Hose Series / 胶管系列"],
    [variant.sku, "Hose SKU / 胶管SKU"],
    [variant.dash, "Hose Dash / 胶管Dash"],
    [variant.notes, "Notes / 备注"],
  ] as const) {
    requiredText(findings, value, field);
  }
  for (const [value, field] of [
    [variant.nominalIdIn, "Nominal ID in / 公称内径英寸"],
    [variant.idMm, "ID mm / 内径毫米"],
    [variant.odMm, "OD mm / 外径毫米"],
    [variant.workingBar, "Working Pressure bar / 工作压力"],
    [variant.workingPsi, "Working Pressure psi / 工作压力"],
    [variant.burstBar, "Minimum Burst bar / 最小爆破压力"],
    [variant.bendRadiusMm, "Min Bend Radius mm / 最小弯曲半径"],
    [variant.weightKgM, "Weight kg/m / 米重"],
  ] as const) {
    requiredNumber(findings, value, field, true);
  }
  const override = normalizedText(input.imageOverrideReference);
  if (
    override &&
    !isUploadedMainImageReference(override) &&
    !hoseSeriesFromMainImageReference(override)
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
        "Hose SKU / 胶管SKU",
        "sku_immutable",
        "Hose SKU cannot be changed / 胶管SKU不可修改",
        variant.sku,
      ),
    );
  }
  if (findings.length > 0) {
    throw new HoseMaintenanceRejected(
      "Hose Variant was not saved / 胶管子体未保存",
      findings,
    );
  }
  const series = await repository.findHoseSeries(variant.hoseSeries);
  if (!series) {
    throw new HoseMaintenanceRejected(
      "Select an existing Hose Series / 请选择已有胶管系列",
      [
        finding(
          "Hose Series / 胶管系列",
          "series_not_found",
          "Selected Hose Series does not exist / 所选胶管系列不存在",
          variant.sku,
        ),
      ],
    );
  }
  const existing = await repository.findProductIdentity(variant.sku);
  if (input.mode === "create" && existing) {
    throw new HoseMaintenanceRejected(
      "Hose SKU already exists; open it for editing / 胶管SKU已存在，请打开后编辑",
    );
  }
  if (input.mode === "edit" && (!existing || existing.productType !== "hose")) {
    throw new HoseMaintenanceRejected(
      "Hose Variant was not found / 未找到胶管子体",
    );
  }
  return { imageOverrideReference: override, series, variant };
}

export async function maintainHoseVariant(
  repository: CatalogHoseMaintenanceRepository,
  input: MaintainHoseVariantInput,
) {
  const validated = await validateHoseVariantMaintenance(repository, input);
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  return repository.saveHoseVariant({
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
