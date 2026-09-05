import {
  hoseMainImageReference,
  hoseSeriesFromMainImageReference,
  isUploadedMainImageReference,
} from "./catalog-main-image";
import {
  validateCatalogWorksheetRecord,
  type CatalogImportValidationResult,
  type CatalogPublicationStatus,
  type CatalogSkuDraft,
  type CatalogWorkbookCell,
  type HoseVariantDraft,
  type RfqEligibility,
  type SalesOfferDraft,
  type TechnicalDataStatus,
} from "./catalog-workbook";
import {
  productLifecycleState,
  type ProductLifecycleStatus,
} from "./catalog-product-lifecycle";

export const manualHoseWorksheet = "01_胶管主数据";
export const manualSalesWorksheet = "07_价格包装";

export interface ManualHoseRecord {
  hose: HoseVariantDraft;
  mainImageReference: string;
  release: {
    id: string;
    releaseNumber: string;
    status: "draft" | "published";
  };
  salesOffer: SalesOfferDraft;
  supplyAvailability?:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
}

export interface ManualCatalogProductIdentity {
  productType: CatalogSkuDraft["productType"];
  sku: string;
}

export interface ManualHoseSubmission {
  hoseValues: Record<string, CatalogWorkbookCell | undefined>;
  mainImageReference: string;
  mode: "create" | "edit";
  originalSalesSku: string | null;
  originalSku: string | null;
  replaceSharedImageFrom?: string | null;
  salesValues: Record<string, CatalogWorkbookCell | undefined>;
  lifecycleStatus?: ProductLifecycleStatus;
}

export interface SaveManualHoseOperation {
  actorId: string;
  auditEventId: string;
  costBasisId: string;
  draftImportId: string;
  draftReleaseId: string;
  draftReleaseNumber: string;
  hose: HoseVariantDraft;
  hoseId: string;
  mainImageReference: string;
  mediaAssignmentId: string;
  mode: "create" | "edit";
  occurredAt: string;
  replaceSharedImageFrom: string | null;
  salesOffer: SalesOfferDraft;
  salesOfferId: string;
  skuId: string;
  supplyAvailability?:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
}

export interface ManualHoseSaveResult {
  draftReleaseId: string;
  draftReleaseNumber: string;
  mode: "created" | "updated";
  imageAffectedSkus?: string[];
  sku: string;
}

export interface CatalogManualHoseRepository {
  findHoseByExactSku(sku: string): Promise<ManualHoseRecord | null>;
  findProductIdentity(
    sku: string,
  ): Promise<ManualCatalogProductIdentity | null>;
  saveManualHose(
    operation: SaveManualHoseOperation,
  ): Promise<ManualHoseSaveResult>;
}

export interface MaintainManualHoseInput extends ManualHoseSubmission {
  actorId: string;
  generateId?: () => string;
  now?: () => Date;
}

export class ManualHoseEntryRejected extends Error {
  constructor(
    message: string,
    readonly findings: CatalogImportValidationResult[] = [],
  ) {
    super(message);
    this.name = "ManualHoseEntryRejected";
  }
}

function normalizedSku(value: CatalogWorkbookCell | undefined) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function textValue(
  values: Record<string, CatalogWorkbookCell | undefined>,
  key: string,
) {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(
  values: Record<string, CatalogWorkbookCell | undefined>,
  key: string,
) {
  return textValue(values, key) || null;
}

function numberValue(
  values: Record<string, CatalogWorkbookCell | undefined>,
  key: string,
) {
  return values[key] as number;
}

function optionalNumber(
  values: Record<string, CatalogWorkbookCell | undefined>,
  key: string,
) {
  const value = values[key];
  return typeof value === "number" ? value : null;
}

function finding(
  worksheet: string,
  sku: string,
  field: string,
  code: string,
  message: string,
): CatalogImportValidationResult {
  return {
    code,
    field,
    message,
    row: 0,
    severity: "error",
    sku: sku || null,
    worksheet,
  };
}

function validatePriceValues(
  values: Record<string, CatalogWorkbookCell | undefined>,
  sku: string,
) {
  const results: CatalogImportValidationResult[] = [];
  const positiveWholeNumbers = [
    ["unitsPerSalesPack", "Units per Sales Pack / 每销售包装数量"],
    ["moq", "MOQ / 最小起订量"],
    ["leadTimeDays", "Lead Time days / 交期天数"],
    ["innerPackQty", "Inner Pack Qty / 内包装数量"],
    ["masterCartonQty", "Master Carton Qty / 每外箱数量"],
  ] as const;
  const positiveNumbers = [
    ["packageLengthFt", "Package Length ft / 包装长度"],
    ["netUnitWeightKg", "Net Unit Weight kg / 单个销售单位净重"],
    ["referencePriceUsd", "Retail Unit Price USD / 零售单价"],
    ["cartonGrossWeightKg", "Carton Gross Weight kg / 整箱毛重"],
    ["cartonLCm", "Carton L cm / 箱长"],
    ["cartonWCm", "Carton W cm / 箱宽"],
    ["cartonHCm", "Carton H cm / 箱高"],
    ["minimumLengthPerPieceFt", "Minimum Length per Piece ft / 每根最小长度"],
    ["lengthIncrementFt", "Length Increment ft / 长度步长"],
    ["presetLength1Ft", "Preset Length 1 ft / 快捷长度1"],
    ["presetLength2Ft", "Preset Length 2 ft / 快捷长度2"],
    ["presetLength3Ft", "Preset Length 3 ft / 快捷长度3"],
  ] as const;

  for (const [key, field] of positiveWholeNumbers) {
    const value = optionalNumber(values, key);
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      results.push(
        finding(
          manualSalesWorksheet,
          sku,
          field,
          "invalid_positive_integer",
          `${field} must be a positive whole number when provided`,
        ),
      );
    }
  }
  for (const [key, field] of positiveNumbers) {
    const value = optionalNumber(values, key);
    if (value !== null && value <= 0) {
      results.push(
        finding(
          manualSalesWorksheet,
          sku,
          field,
          "invalid_positive_number",
          `${field} must be greater than zero when provided`,
        ),
      );
    }
  }
  return results;
}

function toHoseVariant(
  values: Record<string, CatalogWorkbookCell | undefined>,
): HoseVariantDraft {
  return {
    bendRadiusMm: numberValue(values, "bendRadiusMm"),
    burstBar: numberValue(values, "burstBar"),
    catalogPublicationStatus: textValue(
      values,
      "catalogPublicationStatus",
    ) as CatalogPublicationStatus,
    coverColor: textValue(values, "coverColor"),
    coverFinish: optionalText(values, "coverFinish"),
    coverMaterial: textValue(values, "coverMaterial"),
    dash: textValue(values, "dash"),
    equivalentStandard: optionalText(values, "equivalentStandard"),
    fluidCompatibility: textValue(values, "fluidCompatibility"),
    hoseSeries: textValue(values, "hoseSeries"),
    idMm: numberValue(values, "idMm"),
    mshaMarking: optionalText(values, "mshaMarking"),
    nominalIdIn: numberValue(values, "nominalIdIn"),
    notes: optionalText(values, "notes"),
    odMm: numberValue(values, "odMm"),
    origin: textValue(values, "origin"),
    primaryStandard: textValue(values, "primaryStandard"),
    reinforcement: textValue(values, "reinforcement"),
    rfqEligibility: textValue(values, "rfqEligibility") as RfqEligibility,
    skiveRequirement: textValue(values, "skiveRequirement"),
    sku: normalizedSku(values.sku),
    source: textValue(values, "source"),
    technicalDataStatus: textValue(
      values,
      "technicalDataStatus",
    ) as TechnicalDataStatus,
    tempMaxC: numberValue(values, "tempMaxC"),
    tempMinC: numberValue(values, "tempMinC"),
    tubeMaterial: textValue(values, "tubeMaterial"),
    weightKgM: numberValue(values, "weightKgM"),
    workingBar: numberValue(values, "workingBar"),
    workingPsi: optionalNumber(values, "workingPsi"),
  };
}

function toSalesOffer(
  values: Record<string, CatalogWorkbookCell | undefined>,
): SalesOfferDraft {
  return {
    baseSku: normalizedSku(values.baseSku),
    catalogPublicationStatus: textValue(
      values,
      "catalogPublicationStatus",
    ) as CatalogPublicationStatus,
    cartonGrossWeightKg: optionalNumber(values, "cartonGrossWeightKg"),
    cartonHCm: optionalNumber(values, "cartonHCm"),
    cartonLCm: optionalNumber(values, "cartonLCm"),
    cartonWCm: optionalNumber(values, "cartonWCm"),
    continuousLengthConfirmation: optionalText(
      values,
      "continuousLengthConfirmation",
    ),
    countryOfOrigin: textValue(values, "countryOfOrigin"),
    currency: optionalText(values, "currency") as "USD" | null,
    hsCode: optionalText(values, "hsCode"),
    innerPackQty: optionalNumber(values, "innerPackQty"),
    leadTimeDays: numberValue(values, "leadTimeDays"),
    lengthIncrementFt: optionalNumber(values, "lengthIncrementFt"),
    masterCartonQty: optionalNumber(values, "masterCartonQty"),
    minimumLengthPerPieceFt: optionalNumber(values, "minimumLengthPerPieceFt"),
    moq: numberValue(values, "moq"),
    netUnitWeightKg: optionalNumber(values, "netUnitWeightKg"),
    notes: optionalText(values, "notes"),
    packageLengthFt: optionalNumber(values, "packageLengthFt"),
    packingBasis: optionalText(values, "packingBasis"),
    presetLength1Ft: optionalNumber(values, "presetLength1Ft"),
    presetLength2Ft: optionalNumber(values, "presetLength2Ft"),
    presetLength3Ft: optionalNumber(values, "presetLength3Ft"),
    productType: textValue(values, "productType"),
    quantityInputMode: textValue(values, "quantityInputMode"),
    referencePriceUsd: optionalNumber(values, "referencePriceUsd"),
    rfqEligibility: textValue(values, "rfqEligibility") as RfqEligibility,
    salesSku: normalizedSku(values.salesSku),
    salesUnit: textValue(values, "salesUnit"),
    technicalDataStatus: textValue(
      values,
      "technicalDataStatus",
    ) as TechnicalDataStatus,
    unitsPerSalesPack: numberValue(values, "unitsPerSalesPack"),
  };
}

function validateSubmission(input: ManualHoseSubmission) {
  const hoseSku = normalizedSku(input.hoseValues.sku);
  const results = [
    ...validateCatalogWorksheetRecord(manualHoseWorksheet, input.hoseValues),
    ...validateCatalogWorksheetRecord(manualSalesWorksheet, input.salesValues),
    ...validatePriceValues(input.salesValues, hoseSku),
  ];
  const salesSku = normalizedSku(input.salesValues.salesSku);
  const baseSku = normalizedSku(input.salesValues.baseSku);
  const hoseSeries = textValue(input.hoseValues, "hoseSeries");

  if (baseSku && baseSku !== hoseSku) {
    results.push(
      finding(
        manualSalesWorksheet,
        salesSku,
        "Base SKU / 基础SKU",
        "price_base_sku_mismatch",
        "Base SKU must match the Hose SKU",
      ),
    );
  }
  if (textValue(input.salesValues, "productType") !== "Hose Variant") {
    results.push(
      finding(
        manualSalesWorksheet,
        salesSku,
        "Product Type / 产品类型",
        "price_product_type_mismatch",
        'Product Type must be "Hose Variant" for a Hose SKU',
      ),
    );
  }
  for (const [key, field] of [
    ["catalogPublicationStatus", "Catalog Publication Status / 目录发布状态"],
    ["rfqEligibility", "RFQ Eligibility / 询价资格"],
    ["technicalDataStatus", "Technical Data Status / 技术资料状态"],
  ] as const) {
    if (
      textValue(input.hoseValues, key) !== textValue(input.salesValues, key)
    ) {
      results.push(
        finding(
          manualSalesWorksheet,
          salesSku,
          field,
          "price_status_mismatch",
          `${field} must match the Hose product`,
        ),
      );
    }
  }
  if (textValue(input.salesValues, "currency") !== "USD") {
    results.push(
      finding(
        manualSalesWorksheet,
        salesSku,
        "Currency / 币种",
        "price_currency_required",
        "Reference Price must be explicitly denominated in USD",
      ),
    );
  }
  const referencePrice = optionalNumber(input.salesValues, "referencePriceUsd");
  if (referencePrice === null) {
    results.push(
      finding(
        manualSalesWorksheet,
        salesSku,
        "Retail Unit Price USD / 零售单价",
        "reference_price_required",
        "A customer-facing USD Reference Price is required",
      ),
    );
  }
  const imageSeries = hoseSeriesFromMainImageReference(
    input.mainImageReference,
  );
  if (
    !isUploadedMainImageReference(input.mainImageReference) &&
    (!imageSeries || imageSeries !== hoseSeries)
  ) {
    results.push(
      finding(
        manualHoseWorksheet,
        hoseSku,
        "Main Image / 主图",
        "main_image_required",
        "Choose the reviewed representative image for this Hose Series",
      ),
    );
  }
  if (input.mode === "edit" && normalizedSku(input.originalSku) !== hoseSku) {
    results.push(
      finding(
        manualHoseWorksheet,
        hoseSku,
        "Hose SKU / 胶管SKU",
        "published_sku_immutable",
        "A published SKU cannot be renamed; create a replacement SKU instead",
      ),
    );
  }
  if (
    input.mode === "edit" &&
    normalizedSku(input.originalSalesSku) !== salesSku
  ) {
    results.push(
      finding(
        manualSalesWorksheet,
        salesSku,
        "Sales SKU / 销售SKU",
        "published_sales_sku_immutable",
        "An existing Sales SKU cannot be renamed in place",
      ),
    );
  }
  return results;
}

export async function maintainManualHose(
  repository: CatalogManualHoseRepository,
  input: MaintainManualHoseInput,
) {
  const findings = validateSubmission(input);
  if (findings.length > 0) {
    throw new ManualHoseEntryRejected(
      `Manual Hose submission has ${findings.length} validation error${findings.length === 1 ? "" : "s"}`,
      findings,
    );
  }

  const hose = toHoseVariant(input.hoseValues);
  const salesOffer = toSalesOffer(input.salesValues);
  const lifecycle = input.lifecycleStatus
    ? productLifecycleState(input.lifecycleStatus)
    : null;
  if (lifecycle) {
    hose.catalogPublicationStatus = lifecycle.catalogPublicationStatus;
    hose.rfqEligibility = lifecycle.rfqEligibility;
    salesOffer.catalogPublicationStatus = lifecycle.catalogPublicationStatus;
    salesOffer.rfqEligibility = lifecycle.rfqEligibility;
  }
  const existing = await repository.findProductIdentity(hose.sku);
  if (input.mode === "create" && existing) {
    throw new ManualHoseEntryRejected(
      `SKU ${hose.sku} already exists. Load it by exact SKU before editing.`,
    );
  }
  if (input.mode === "edit" && (!existing || existing.productType !== "hose")) {
    throw new ManualHoseEntryRejected(
      `Hose SKU ${hose.sku} was not found in the current catalog.`,
    );
  }

  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const occurredAt = (input.now ?? (() => new Date()))().toISOString();
  const timestamp = occurredAt.replaceAll(/[-:.]/g, "").slice(0, 15);
  const draftReleaseId = generateId();
  const draftImportId = generateId();
  return repository.saveManualHose({
    actorId: input.actorId,
    auditEventId: generateId(),
    costBasisId: generateId(),
    draftImportId,
    draftReleaseId,
    draftReleaseNumber: `DRAFT-${timestamp}-${draftReleaseId.replaceAll("-", "").slice(-8).toUpperCase()}`,
    hose,
    hoseId: generateId(),
    mainImageReference: isUploadedMainImageReference(input.mainImageReference)
      ? input.mainImageReference
      : (hoseMainImageReference(hose.hoseSeries) ?? input.mainImageReference),
    mediaAssignmentId: generateId(),
    mode: input.mode,
    occurredAt,
    replaceSharedImageFrom: input.replaceSharedImageFrom ?? null,
    salesOffer,
    salesOfferId: generateId(),
    skuId: generateId(),
    supplyAvailability: lifecycle?.supplyAvailability,
  });
}
