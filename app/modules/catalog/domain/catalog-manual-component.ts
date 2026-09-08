import {
  adapterMainImageReference,
  ferruleMainImageReference,
  hoseEndMediaKeyFromMainImageReference,
  isUploadedMainImageReference,
  quickCouplerMainImageReference,
} from "./catalog-main-image";
import type { ManualCatalogProductIdentity } from "./catalog-manual-hose";
import {
  productLifecycleState,
  type ProductLifecycleStatus,
} from "./catalog-product-lifecycle";
import {
  validateCatalogWorksheetRecord,
  type CatalogImportValidationResult,
  type CatalogPublicationStatus,
  type CatalogWorkbookCell,
  type AdapterDraft,
  type FerruleDraft,
  type HoseEndDraft,
  type QuickCouplerDraft,
  type RfqEligibility,
  type SalesOfferDraft,
  type TechnicalDataStatus,
} from "./catalog-workbook";

export const manualHoseEndWorksheet = "02_压接接头";
export const manualFerruleWorksheet = "03_套筒";
export const manualAdapterWorksheet = "05_过渡接头";
export const manualQuickCouplerWorksheet = "06_快速接头";
export const manualComponentSalesWorksheet = "07_价格包装";

export type ManualComponentType =
  "adapter" | "ferrule" | "hose_end" | "quick_coupler";

export type ManualComponentMaster =
  AdapterDraft | FerruleDraft | HoseEndDraft | QuickCouplerDraft;

export interface ManualComponentRecord {
  mainImageReference: string;
  master: ManualComponentMaster;
  productType: ManualComponentType;
  release: {
    id: string;
    releaseNumber: string;
    status: "draft" | "published";
  };
  salesOffer: SalesOfferDraft | null;
  supplyAvailability?:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
}

export interface ManualComponentSubmission {
  lifecycleStatus?: ProductLifecycleStatus;
  mainImageReference: string;
  masterValues: Record<string, CatalogWorkbookCell | undefined>;
  mode: "create" | "edit";
  originalSalesSku: string | null;
  originalSku: string | null;
  replaceSharedImageFrom?: string | null;
  productType: ManualComponentType;
  salesValues: Record<string, CatalogWorkbookCell | undefined>;
}

export interface SaveManualComponentOperation {
  actorId: string;
  auditEventId: string;
  componentId: string;
  costBasisId: string;
  draftImportId: string;
  draftReleaseId: string;
  draftReleaseNumber: string;
  mainImageReference: string;
  mediaAssignmentId: string;
  master: ManualComponentMaster;
  mode: "create" | "edit";
  occurredAt: string;
  productType: ManualComponentType;
  replaceSharedImageFrom: string | null;
  salesOffer: SalesOfferDraft | null;
  salesOfferId: string;
  skuId: string;
  supplyAvailability?:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
}

export interface AuditManualComponentRejection {
  actorId: string;
  auditEventId: string;
  findingCodes: string[];
  occurredAt: string;
  productType: ManualComponentType;
  reason: string;
  sku: string;
}

export interface ManualComponentSaveResult {
  draftReleaseId: string;
  draftReleaseNumber: string;
  mode: "created" | "updated";
  imageAffectedSkus?: string[];
  productType: ManualComponentType;
  sku: string;
}

export interface CatalogManualComponentRepository {
  auditManualComponentRejection(
    rejection: AuditManualComponentRejection,
  ): Promise<void>;
  findComponentByExactSku(
    productType: ManualComponentType,
    sku: string,
  ): Promise<ManualComponentRecord | null>;
  findProductIdentity(
    sku: string,
  ): Promise<ManualCatalogProductIdentity | null>;
  saveManualComponent(
    operation: SaveManualComponentOperation,
  ): Promise<ManualComponentSaveResult>;
}

export interface MaintainManualComponentInput extends ManualComponentSubmission {
  actorId: string;
  generateId?: () => string;
  now?: () => Date;
}

export class ManualComponentEntryRejected extends Error {
  constructor(
    message: string,
    readonly findings: CatalogImportValidationResult[] = [],
  ) {
    super(message);
    this.name = "ManualComponentEntryRejected";
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

function optionalNumber(
  values: Record<string, CatalogWorkbookCell | undefined>,
  key: string,
) {
  const value = values[key];
  return typeof value === "number" ? value : null;
}

function numberValue(
  values: Record<string, CatalogWorkbookCell | undefined>,
  key: string,
) {
  return values[key] as number;
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

function productContract(productType: ManualComponentType) {
  switch (productType) {
    case "hose_end":
      return {
        label: "Hose End",
        productType: "Hose End",
        skuKey: "sku",
        worksheet: manualHoseEndWorksheet,
      } as const;
    case "ferrule":
      return {
        label: "Ferrule",
        productType: "Ferrule",
        skuKey: "sku",
        worksheet: manualFerruleWorksheet,
      } as const;
    case "adapter":
      return {
        label: "Adapter",
        productType: "Adapter",
        skuKey: "adapterSku",
        worksheet: manualAdapterWorksheet,
      } as const;
    case "quick_coupler":
      return {
        label: "Quick Coupler",
        productType: "Quick Coupler",
        skuKey: "sku",
        worksheet: manualQuickCouplerWorksheet,
      } as const;
  }
}

function submissionSku(input: ManualComponentSubmission) {
  return normalizedSku(
    input.masterValues[productContract(input.productType).skuKey],
  );
}

function validatePositiveNumbers(
  values: Record<string, CatalogWorkbookCell | undefined>,
  worksheet: string,
  sku: string,
  fields: readonly (readonly [string, string, "integer" | "number"])[],
) {
  const results: CatalogImportValidationResult[] = [];
  for (const [key, field, kind] of fields) {
    const value = optionalNumber(values, key);
    if (
      value !== null &&
      (value <= 0 || (kind === "integer" && !Number.isInteger(value)))
    ) {
      results.push(
        finding(
          worksheet,
          sku,
          field,
          kind === "integer"
            ? "invalid_positive_integer"
            : "invalid_positive_number",
          kind === "integer"
            ? `${field} must be a positive whole number when provided`
            : `${field} must be greater than zero when provided`,
        ),
      );
    }
  }
  return results;
}

const componentPositiveFields = [
  ["saltSprayHours", "Salt Spray h / 盐雾小时", "number"],
  ["maxWorkingBar", "Max Working bar / 最大工作压力", "number"],
  ["dimensionAMm", "Dimension A mm / 总长A", "number"],
  ["cutoffBMm", "Cut-off B mm / 扣除量B", "number"],
  ["hex1Mm", "Hex 1 mm / 六角1", "number"],
  ["hex2Mm", "Hex 2 mm / 六角2", "number"],
  ["minimumBoreMm", "Minimum Bore mm / 最小通径", "number"],
  ["unitWeightG", "Unit Weight g / 单重", "number"],
] as const;

const quickCouplerPositiveFields = [
  ["maxWorkingBar", "Max Working bar / 最大工作压力", "number"],
  ["minimumBurstBar", "Minimum Burst bar / 最小爆破压力", "number"],
  ["ratedFlowLMin", "Rated Flow L/min / 额定流量", "number"],
  ["overallLengthMm", "Overall Length mm / 总长", "number"],
  ["unitWeightG", "Unit Weight g / 单重", "number"],
] as const;

const salesPositiveFields = [
  ["unitsPerSalesPack", "Units per Sales Pack / 每销售包装数量", "integer"],
  ["moq", "MOQ / 最小起订量", "integer"],
  ["leadTimeDays", "Lead Time days / 交期天数", "integer"],
  ["innerPackQty", "Inner Pack Qty / 内包装数量", "integer"],
  ["masterCartonQty", "Master Carton Qty / 每外箱数量", "integer"],
  ["packageLengthFt", "Package Length ft / 包装长度", "number"],
  ["netUnitWeightKg", "Net Unit Weight kg / 单个销售单位净重", "number"],
  ["referencePriceUsd", "Retail Unit Price USD / 零售单价", "number"],
  ["cartonGrossWeightKg", "Carton Gross Weight kg / 整箱毛重", "number"],
  ["cartonLCm", "Carton L cm / 箱长", "number"],
  ["cartonWCm", "Carton W cm / 箱宽", "number"],
  ["cartonHCm", "Carton H cm / 箱高", "number"],
] as const;

function toHoseEnd(
  values: Record<string, CatalogWorkbookCell | undefined>,
): HoseEndDraft {
  return {
    angle: textValue(values, "angle"),
    catalogPublicationStatus: textValue(
      values,
      "catalogPublicationStatus",
    ) as CatalogPublicationStatus,
    coating: optionalText(values, "coating"),
    competitorPartNumber: optionalText(values, "competitorPartNumber"),
    connectionDash: textValue(values, "connectionDash"),
    connectionStandard: textValue(values, "connectionStandard"),
    cutoffBMm: optionalNumber(values, "cutoffBMm"),
    dimensionAMm: optionalNumber(values, "dimensionAMm"),
    drawingNumber: optionalText(values, "drawingNumber"),
    drawingRevision: optionalText(values, "drawingRevision"),
    fittingSeries: textValue(values, "fittingSeries"),
    gender: textValue(values, "gender"),
    hex1Mm: optionalNumber(values, "hex1Mm"),
    hex2Mm: optionalNumber(values, "hex2Mm"),
    hoseTailDash: textValue(values, "hoseTailDash"),
    interfaceFamily: textValue(values, "interfaceFamily"),
    material: optionalText(values, "material"),
    maxWorkingBar: optionalNumber(values, "maxWorkingBar"),
    minimumBoreMm: optionalNumber(values, "minimumBoreMm"),
    notes: optionalText(values, "notes"),
    rfqEligibility: textValue(values, "rfqEligibility") as RfqEligibility,
    saltSprayHours: optionalNumber(values, "saltSprayHours"),
    sealingForm: textValue(values, "sealingForm"),
    sku: normalizedSku(values.sku),
    source: textValue(values, "source"),
    swivelForm: textValue(values, "swivelForm"),
    technicalDataStatus: textValue(
      values,
      "technicalDataStatus",
    ) as TechnicalDataStatus,
    thread: textValue(values, "thread"),
    unitWeightG: optionalNumber(values, "unitWeightG"),
  };
}

function toFerrule(
  values: Record<string, CatalogWorkbookCell | undefined>,
): FerruleDraft {
  return {
    catalogPublicationStatus: textValue(
      values,
      "catalogPublicationStatus",
    ) as CatalogPublicationStatus,
    coating: textValue(values, "coating"),
    ferruleSeries: textValue(values, "ferruleSeries"),
    hoseConstruction: textValue(values, "hoseConstruction"),
    hoseTailDash: textValue(values, "hoseTailDash"),
    material: textValue(values, "material"),
    notes: optionalText(values, "notes"),
    rfqEligibility: textValue(values, "rfqEligibility") as RfqEligibility,
    skiveRequirement: textValue(values, "skiveRequirement"),
    sku: normalizedSku(values.sku),
    source: textValue(values, "source"),
    technicalDataStatus: textValue(
      values,
      "technicalDataStatus",
    ) as TechnicalDataStatus,
  };
}

function toAdapter(
  values: Record<string, CatalogWorkbookCell | undefined>,
): AdapterDraft {
  return {
    adapterFamilyId: textValue(values, "adapterFamilyId"),
    catalogModel: textValue(values, "catalogModel"),
    catalogPublicationStatus: textValue(
      values,
      "catalogPublicationStatus",
    ) as CatalogPublicationStatus,
    connectionForm1: textValue(values, "connectionForm1"),
    connectionForm2: textValue(values, "connectionForm2"),
    connectionForm3: optionalText(values, "connectionForm3"),
    interface1: textValue(values, "interface1"),
    interface2: textValue(values, "interface2"),
    interface3: optionalText(values, "interface3"),
    notes: optionalText(values, "notes"),
    rfqEligibility: textValue(values, "rfqEligibility") as RfqEligibility,
    shapeCode: textValue(values, "shapeCode"),
    size1: optionalText(values, "size1"),
    size2: optionalText(values, "size2"),
    size3: optionalText(values, "size3"),
    sku: normalizedSku(values.adapterSku),
    skuTemplate: textValue(values, "skuTemplate"),
    source: textValue(values, "source"),
    technicalDataStatus: textValue(
      values,
      "technicalDataStatus",
    ) as TechnicalDataStatus,
    websiteDisplay: textValue(values, "websiteDisplay"),
    websiteProductName: textValue(values, "websiteProductName"),
  };
}

const quickCouplerRoleCodes = {
  "Complete Pair": "SET",
  "Coupler/Socket": "SOC",
  "Plug/Nipple": "PLG",
} as const;

const quickCouplerStandardCodes: Record<string, string> = {
  "ISO 16028": "16028",
  "ISO 5675": "5675",
  "ISO 7241-1 Series A": "7241A",
  "ISO 7241-1 Series B": "7241B",
};

function quickCouplerSkuParts(sku: string) {
  const match = sku.match(
    /^QDC_([^_]+)_([^_]+)_([0-9]{2})_([^_]+)_([0-9]{2})$/,
  );
  return match
    ? {
        bodyDash: match[3],
        portCode: match[4],
        portDash: match[5],
        roleCode: match[2],
        standardCode: match[1],
      }
    : null;
}

function bodySizeDash(bodySize: string) {
  return (
    {
      "1/4 in": "04",
      "3/8 in": "06",
      "1/2 in": "08",
      "3/4 in": "12",
      "1 in": "16",
    } as Record<string, string>
  )[bodySize];
}

function portCode(values: Record<string, CatalogWorkbookCell | undefined>) {
  const gender = textValue(values, "portGender");
  const port = textValue(values, "portInterface");
  const interfaceCode = port === "NPTF" ? "NPT" : port;
  return `${gender === "Female" ? "F" : gender === "Male" ? "M" : ""}${interfaceCode}`;
}

function portThreadDash(
  values: Record<string, CatalogWorkbookCell | undefined>,
) {
  const portInterface = textValue(values, "portInterface");
  const portThread = textValue(values, "portThread");
  if (portInterface === "ORB" && portThread.startsWith("3/4-16")) return "08";
  return bodySizeDash(`${portThread.split("-")[0]} in`);
}

function toQuickCoupler(
  values: Record<string, CatalogWorkbookCell | undefined>,
): QuickCouplerDraft {
  const sku = normalizedSku(values.sku);
  const parts = quickCouplerSkuParts(sku);
  if (!parts) throw new Error(`Validated Quick Coupler SKU is invalid: ${sku}`);
  return {
    bodyDash: parts.bodyDash,
    bodyMaterial: optionalText(values, "bodyMaterial"),
    bodySize: textValue(values, "bodySize"),
    catalogPublicationStatus: textValue(
      values,
      "catalogPublicationStatus",
    ) as CatalogPublicationStatus,
    coating: optionalText(values, "coating"),
    connectionMechanism: textValue(values, "connectionMechanism"),
    couplerSeries: textValue(values, "couplerSeries"),
    drawingNumber: optionalText(values, "drawingNumber"),
    interchangeStandard: textValue(values, "interchangeStandard"),
    matingSeries: textValue(values, "matingSeries"),
    maxWorkingBar: optionalNumber(values, "maxWorkingBar"),
    minimumBurstBar: optionalNumber(values, "minimumBurstBar"),
    notes: optionalText(values, "notes"),
    overallLengthMm: optionalNumber(values, "overallLengthMm"),
    portCode: parts.portCode,
    portDash: parts.portDash,
    portGender: textValue(values, "portGender"),
    portInterface: textValue(values, "portInterface"),
    portThread: textValue(values, "portThread"),
    pressureDropBasis: optionalText(values, "pressureDropBasis"),
    ratedFlowLMin: optionalNumber(values, "ratedFlowLMin"),
    rfqEligibility: textValue(values, "rfqEligibility") as RfqEligibility,
    role: textValue(values, "role"),
    sealMaterial: optionalText(values, "sealMaterial"),
    sku,
    skuRoleCode: parts.roleCode,
    skuStandardCode: parts.standardCode,
    source: textValue(values, "source"),
    technicalDataStatus: textValue(
      values,
      "technicalDataStatus",
    ) as TechnicalDataStatus,
    tempMaxC: optionalNumber(values, "tempMaxC"),
    tempMinC: optionalNumber(values, "tempMinC"),
    unitWeightG: optionalNumber(values, "unitWeightG"),
    valving: textValue(values, "valving"),
  };
}

function validateAdapterSku(
  values: Record<string, CatalogWorkbookCell | undefined>,
  worksheet: string,
  sku: string,
) {
  const size1 = textValue(values, "size1");
  const size2 = textValue(values, "size2");
  if (!size1 || !size2) {
    return [
      finding(
        worksheet,
        sku,
        !size1 ? "Size 1 / 尺寸1" : "Size 2 / 尺寸2",
        "adapter_sku_size_required",
        "A concrete Adapter SKU requires both Size 1 and Size 2",
      ),
    ];
  }
  const dashToken = (value: string) => value.replace(/^-/, "").padStart(2, "0");
  const expected = [
    "ADP",
    textValue(values, "shapeCode"),
    textValue(values, "interface1"),
    textValue(values, "connectionForm1"),
    dashToken(size1),
    textValue(values, "interface2"),
    textValue(values, "connectionForm2"),
    dashToken(size2),
  ]
    .join("_")
    .toUpperCase();
  return sku === expected
    ? []
    : [
        finding(
          worksheet,
          sku,
          "Adapter SKU / 过渡接头SKU",
          "invalid_adapter_sku",
          `Adapter SKU must be "${expected}" for the exact shape, interfaces, forms, and sizes`,
        ),
      ];
}

function validateQuickCouplerSku(
  values: Record<string, CatalogWorkbookCell | undefined>,
  worksheet: string,
  sku: string,
) {
  const parts = quickCouplerSkuParts(sku);
  const expected = {
    bodyDash: bodySizeDash(textValue(values, "bodySize")),
    portCode: portCode(values),
    portDash: portThreadDash(values),
    roleCode:
      quickCouplerRoleCodes[
        textValue(values, "role") as keyof typeof quickCouplerRoleCodes
      ],
    standardCode:
      quickCouplerStandardCodes[textValue(values, "interchangeStandard")],
  };
  return parts &&
    Object.entries(expected).every(
      ([key, value]) =>
        Boolean(value) && parts[key as keyof typeof parts] === value,
    )
    ? []
    : [
        finding(
          worksheet,
          sku,
          "Quick Coupler SKU / 快接SKU",
          "invalid_quick_coupler_sku",
          "Quick Coupler SKU does not match its standard, role, Body Size, port, or Port Thread",
        ),
      ];
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

function validateSubmission(input: ManualComponentSubmission) {
  const contract = productContract(input.productType);
  const sku = submissionSku(input);
  const hasLegacySalesValues = Object.values(input.salesValues).some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  const salesSku = normalizedSku(input.salesValues.salesSku);
  const expectedSalesProductType =
    input.productType === "quick_coupler" &&
    textValue(input.masterValues, "role") === "Plug/Nipple"
      ? "Quick Plug"
      : contract.productType;
  const results = [
    ...validateCatalogWorksheetRecord(contract.worksheet, input.masterValues),
    ...(hasLegacySalesValues
      ? validateCatalogWorksheetRecord(
          manualComponentSalesWorksheet,
          input.salesValues,
        )
      : []),
    ...validatePositiveNumbers(
      input.masterValues,
      contract.worksheet,
      sku,
      input.productType === "hose_end"
        ? componentPositiveFields
        : input.productType === "quick_coupler"
          ? quickCouplerPositiveFields
          : [],
    ),
    ...(hasLegacySalesValues
      ? validatePositiveNumbers(
          input.salesValues,
          manualComponentSalesWorksheet,
          sku,
          salesPositiveFields,
        )
      : []),
  ];

  if (input.productType === "adapter") {
    results.push(
      ...validateAdapterSku(input.masterValues, contract.worksheet, sku),
    );
  }
  if (input.productType === "quick_coupler") {
    results.push(
      ...validateQuickCouplerSku(input.masterValues, contract.worksheet, sku),
    );
    const tempMin = optionalNumber(input.masterValues, "tempMinC");
    const tempMax = optionalNumber(input.masterValues, "tempMaxC");
    if (tempMin !== null && tempMax !== null && tempMin > tempMax) {
      results.push(
        finding(
          contract.worksheet,
          sku,
          "Temperature range / 温度范围",
          "invalid_temperature_range",
          "Minimum temperature cannot exceed maximum temperature",
        ),
      );
    }
  }

  if (
    hasLegacySalesValues &&
    normalizedSku(input.salesValues.baseSku) !== sku
  ) {
    results.push(
      finding(
        manualComponentSalesWorksheet,
        salesSku,
        "Base SKU / 基础SKU",
        "price_base_sku_mismatch",
        `Base SKU must match the ${contract.label} SKU`,
      ),
    );
  }
  if (
    hasLegacySalesValues &&
    textValue(input.salesValues, "productType") !== expectedSalesProductType
  ) {
    results.push(
      finding(
        manualComponentSalesWorksheet,
        salesSku,
        "Product Type / 产品类型",
        "price_product_type_mismatch",
        `Product Type must be "${expectedSalesProductType}"`,
      ),
    );
  }
  for (const [key, field] of [
    ["catalogPublicationStatus", "Catalog Publication Status / 目录发布状态"],
    ["rfqEligibility", "RFQ Eligibility / 询价资格"],
    ["technicalDataStatus", "Technical Data Status / 技术资料状态"],
  ] as const) {
    if (
      hasLegacySalesValues &&
      textValue(input.masterValues, key) !== textValue(input.salesValues, key)
    ) {
      results.push(
        finding(
          manualComponentSalesWorksheet,
          salesSku,
          field,
          "price_status_mismatch",
          `${field} must match the ${contract.label} product`,
        ),
      );
    }
  }
  if (
    hasLegacySalesValues &&
    textValue(input.salesValues, "currency") !== "USD"
  ) {
    results.push(
      finding(
        manualComponentSalesWorksheet,
        salesSku,
        "Currency / 币种",
        "price_currency_required",
        "Reference Price must be explicitly denominated in USD",
      ),
    );
  }
  if (
    hasLegacySalesValues &&
    optionalNumber(input.salesValues, "referencePriceUsd") === null
  ) {
    results.push(
      finding(
        manualComponentSalesWorksheet,
        salesSku,
        "Retail Unit Price USD / 零售单价",
        "reference_price_required",
        "A customer-facing USD Reference Price is required",
      ),
    );
  }

  const imageIsReviewed = {
    adapter: Boolean(adapterMainImageReference(input.mainImageReference)),
    ferrule: Boolean(ferruleMainImageReference(input.mainImageReference)),
    hose_end: Boolean(
      hoseEndMediaKeyFromMainImageReference(input.mainImageReference),
    ),
    quick_coupler: Boolean(
      quickCouplerMainImageReference(input.mainImageReference),
    ),
  }[input.productType];
  if (
    !imageIsReviewed &&
    !isUploadedMainImageReference(input.mainImageReference)
  ) {
    results.push(
      finding(
        contract.worksheet,
        sku,
        "Main Image / 主图",
        "main_image_required",
        `Choose one reviewed ${contract.label} representative image`,
      ),
    );
  }
  if (input.mode === "edit" && normalizedSku(input.originalSku) !== sku) {
    results.push(
      finding(
        contract.worksheet,
        sku,
        `${contract.label} SKU`,
        "published_sku_immutable",
        "A published SKU cannot be renamed; create a replacement SKU instead",
      ),
    );
  }
  if (
    hasLegacySalesValues &&
    input.mode === "edit" &&
    normalizedSku(input.originalSalesSku) !== salesSku
  ) {
    results.push(
      finding(
        manualComponentSalesWorksheet,
        salesSku,
        "Sales SKU / 销售SKU",
        "published_sales_sku_immutable",
        "An existing Sales SKU cannot be renamed in place",
      ),
    );
  }
  return results;
}

export function validateItemComponent(input: ManualComponentSubmission) {
  const findings = validateSubmission({ ...input, salesValues: {} });
  if (findings.length)
    throw new ManualComponentEntryRejected(
      "Correct product parameters / 请更正产品参数",
      findings,
    );
  return {
    adapter: toAdapter,
    ferrule: toFerrule,
    hose_end: toHoseEnd,
    quick_coupler: toQuickCoupler,
  }[input.productType](input.masterValues);
}

export async function maintainManualComponent(
  repository: CatalogManualComponentRepository,
  input: MaintainManualComponentInput,
) {
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const occurredAt = (input.now ?? (() => new Date()))().toISOString();
  const sku = submissionSku(input);
  const reject = async (
    message: string,
    findings: CatalogImportValidationResult[] = [],
  ): Promise<never> => {
    await repository.auditManualComponentRejection({
      actorId: input.actorId,
      auditEventId: generateId(),
      findingCodes: findings.map((item) => item.code),
      occurredAt,
      productType: input.productType,
      reason: message,
      sku,
    });
    throw new ManualComponentEntryRejected(message, findings);
  };

  const findings = validateSubmission(input);
  if (findings.length > 0) {
    return reject(
      `Manual ${productContract(input.productType).label} submission has ${findings.length} validation error${findings.length === 1 ? "" : "s"}`,
      findings,
    );
  }

  const existing = await repository.findProductIdentity(sku);
  if (input.mode === "create" && existing) {
    return reject(
      `SKU ${sku} already exists. Load it by exact SKU before editing.`,
    );
  }
  if (
    input.mode === "edit" &&
    (!existing || existing.productType !== input.productType)
  ) {
    return reject(
      `${productContract(input.productType).label} SKU ${sku} was not found in the current catalog.`,
    );
  }

  const master = {
    adapter: () => toAdapter(input.masterValues),
    ferrule: () => toFerrule(input.masterValues),
    hose_end: () => toHoseEnd(input.masterValues),
    quick_coupler: () => toQuickCoupler(input.masterValues),
  }[input.productType]();
  const salesOffer = Object.values(input.salesValues).some(
    (value) => value !== undefined && value !== null && value !== "",
  )
    ? toSalesOffer(input.salesValues)
    : null;
  const lifecycle = input.lifecycleStatus
    ? productLifecycleState(input.lifecycleStatus)
    : null;
  if (lifecycle) {
    master.catalogPublicationStatus = lifecycle.catalogPublicationStatus;
    master.rfqEligibility = lifecycle.rfqEligibility;
    if (salesOffer) {
      salesOffer.catalogPublicationStatus = lifecycle.catalogPublicationStatus;
      salesOffer.rfqEligibility = lifecycle.rfqEligibility;
    }
  }
  const timestamp = occurredAt.replaceAll(/[-:.]/g, "").slice(0, 15);
  const draftReleaseId = generateId();
  const draftImportId = generateId();
  return repository.saveManualComponent({
    actorId: input.actorId,
    auditEventId: generateId(),
    componentId: generateId(),
    costBasisId: generateId(),
    draftImportId,
    draftReleaseId,
    draftReleaseNumber: `DRAFT-${timestamp}-${draftReleaseId.replaceAll("-", "").slice(-8).toUpperCase()}`,
    mainImageReference: input.mainImageReference,
    mediaAssignmentId: generateId(),
    master,
    mode: input.mode,
    occurredAt,
    productType: input.productType,
    replaceSharedImageFrom: input.replaceSharedImageFrom ?? null,
    salesOffer,
    salesOfferId: generateId(),
    skuId: generateId(),
    supplyAvailability: lifecycle?.supplyAvailability,
  });
}
