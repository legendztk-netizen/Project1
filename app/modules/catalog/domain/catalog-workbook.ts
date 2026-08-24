export type CatalogWorkbookCell = string | number | boolean | Date | null;

export interface CatalogWorkbookSheet {
  data: CatalogWorkbookCell[][];
  sheet: string;
}

export interface CatalogImportValidationResult {
  code: string;
  field: string;
  message: string;
  row: number;
  severity: "error" | "warning";
  sku: string | null;
  worksheet: string;
}

export type CatalogPublicationStatus = "Draft" | "Published" | "Archived";
export type RfqEligibility = "Eligible" | "Manual Quote Only" | "Blocked";
export type TechnicalDataStatus = "Complete" | "Inherited" | "Pending";
export type QualificationStatus =
  "Approved" | "Pending" | "Rejected" | "Not Tested";

export interface CatalogSkuDraft {
  catalogPublicationStatus: CatalogPublicationStatus;
  hoseSeries: string | null;
  productType: "hose" | "hose_end" | "ferrule";
  rfqEligibility: RfqEligibility;
  sku: string;
  sourceWorksheet: string;
  supplyAvailability: "temporarily_unavailable";
  technicalDataStatus: TechnicalDataStatus;
}

export interface HoseVariantDraft {
  bendRadiusMm: number;
  burstBar: number;
  catalogPublicationStatus: CatalogPublicationStatus;
  coverColor: string;
  coverFinish: string | null;
  coverMaterial: string;
  dash: string;
  fluidCompatibility: string;
  hoseSeries: string;
  idMm: number;
  mshaMarking: string | null;
  nominalIdIn: number;
  notes: string | null;
  odMm: number;
  origin: string;
  primaryStandard: string;
  reinforcement: string;
  rfqEligibility: RfqEligibility;
  skiveRequirement: string;
  sku: string;
  source: string;
  technicalDataStatus: TechnicalDataStatus;
  tempMaxC: number;
  tempMinC: number;
  tubeMaterial: string;
  equivalentStandard: string | null;
  weightKgM: number;
  workingBar: number;
  workingPsi: number | null;
}

export interface HoseEndDraft {
  angle: string;
  catalogPublicationStatus: CatalogPublicationStatus;
  coating: string | null;
  competitorPartNumber: string | null;
  connectionDash: string;
  connectionStandard: string;
  cutoffBMm: number | null;
  dimensionAMm: number | null;
  drawingNumber: string | null;
  drawingRevision: string | null;
  fittingSeries: string;
  gender: string;
  hex1Mm: number | null;
  hex2Mm: number | null;
  hoseTailDash: string;
  interfaceFamily: string;
  material: string | null;
  maxWorkingBar: number | null;
  minimumBoreMm: number | null;
  notes: string | null;
  rfqEligibility: RfqEligibility;
  saltSprayHours: number | null;
  sealingForm: string;
  sku: string;
  source: string;
  swivelForm: string;
  technicalDataStatus: TechnicalDataStatus;
  thread: string;
  unitWeightG: number | null;
}

export interface FerruleDraft {
  catalogPublicationStatus: CatalogPublicationStatus;
  coating: string;
  ferruleSeries: string;
  hoseConstruction: string;
  hoseTailDash: string;
  material: string;
  notes: string | null;
  rfqEligibility: RfqEligibility;
  skiveRequirement: string;
  sku: string;
  source: string;
  technicalDataStatus: TechnicalDataStatus;
}

export interface CompatibilityDraft {
  assemblyMethod: string | null;
  assemblyWorkingBar: number | null;
  catalogPublicationStatus: CatalogPublicationStatus;
  compatibilityId: string;
  crimpProgram: string | null;
  ferruleSku: string;
  finalCrimpDiameterMm: number | null;
  hoseEndSku: string;
  hoseSku: string;
  innerSkiveLengthMm: number | null;
  insertionDepthMm: number | null;
  measurementLocation: string | null;
  notes: string | null;
  outerSkiveLengthMm: number | null;
  productionApprovalStatus: "approved" | "not_approved";
  proofHoldSeconds: number | null;
  proofPressureBar: number | null;
  qualificationId: string | null;
  qualificationStatus: QualificationStatus;
  referenceAssemblyMethod: string | null;
  referenceCrimpDiameterMm: number | null;
  referenceHoseCode: string | null;
  referenceSource: string | null;
  referenceSystem: string | null;
  referenceToleranceMm: number | null;
  rfqEligibility: RfqEligibility;
  skiveRequirement: string | null;
  technicalDataStatus: TechnicalDataStatus;
  toleranceMm: number | null;
}

export interface ValidatedCatalogDraft {
  compatibilities: CompatibilityDraft[];
  ferrules: FerruleDraft[];
  hoseEnds: HoseEndDraft[];
  hoseSeries: string[];
  hoseVariants: HoseVariantDraft[];
  skus: CatalogSkuDraft[];
}

export interface CatalogWorkbookValidation {
  blockingErrors: CatalogImportValidationResult[];
  draft: ValidatedCatalogDraft | null;
  validationResults: CatalogImportValidationResult[];
}

type FieldKind = "number" | "text";

interface FieldContract {
  controlledValues?: readonly string[];
  header: string;
  key: string;
  kind: FieldKind;
  required: boolean;
}

interface WorksheetContract {
  fields: readonly FieldContract[];
  name: string;
  skuKey: string;
}

interface ParsedRow {
  rowNumber: number;
  sku: string | null;
  values: Record<string, CatalogWorkbookCell>;
  worksheet: string;
}

const PUBLICATION_STATUSES = [
  "Draft",
  "Published",
  "Archived",
] as const satisfies readonly CatalogPublicationStatus[];
const RFQ_ELIGIBILITY = [
  "Eligible",
  "Manual Quote Only",
  "Blocked",
] as const satisfies readonly RfqEligibility[];
const TECHNICAL_DATA_STATUSES = [
  "Complete",
  "Inherited",
  "Pending",
] as const satisfies readonly TechnicalDataStatus[];
const QUALIFICATION_STATUSES = [
  "Approved",
  "Pending",
  "Rejected",
  "Not Tested",
] as const satisfies readonly QualificationStatus[];
const DASH_VALUES = [
  "-2",
  "-3",
  "-4",
  "-5",
  "-6",
  "-8",
  "-10",
  "-12",
  "-14",
  "-16",
  "-20",
  "-24",
  "-32",
  "-40",
  "-48",
  "-56",
  "-64",
] as const;
const SKIVE_REQUIREMENTS = [
  "No Skive",
  "External Skive",
  "Internal + External Skive",
  "Other",
] as const;
const COATINGS = [
  "Zinc plating",
  "Zinc Nickel",
  "Trivalent Zinc",
  "Stainless Steel",
  "Brass",
  "Uncoated",
  "Other",
] as const;
const YES_NO_NA = ["Yes", "No", "N/A"] as const;

const textField = (
  key: string,
  header: string,
  required: boolean,
  controlledValues?: readonly string[],
): FieldContract => ({ controlledValues, header, key, kind: "text", required });

const numberField = (
  key: string,
  header: string,
  required: boolean,
): FieldContract => ({ header, key, kind: "number", required });

const statusFields = {
  publication: textField(
    "catalogPublicationStatus",
    "* Catalog Publication Status / 目录发布状态",
    true,
    PUBLICATION_STATUSES,
  ),
  rfq: textField(
    "rfqEligibility",
    "* RFQ Eligibility / 询价资格",
    true,
    RFQ_ELIGIBILITY,
  ),
  technical: textField(
    "technicalDataStatus",
    "* Technical Data Status / 技术资料状态",
    true,
    TECHNICAL_DATA_STATUSES,
  ),
};

const WORKSHEET_CONTRACTS: readonly WorksheetContract[] = [
  {
    name: "01_胶管主数据",
    skuKey: "sku",
    fields: [
      statusFields.publication,
      textField("sku", "* Hose SKU / 胶管SKU", true),
      textField("hoseSeries", "* Hose Series / 系列", true, [
        "601R1",
        "601R2",
        "EN1SC",
        "EN2SC",
        "EN4SP",
        "EN4SH",
      ]),
      textField("primaryStandard", "* Primary Standard / 主标准", true),
      textField("equivalentStandard", "Equivalent Standard / 等效标准", false),
      textField("dash", "* Hose Dash / 胶管Dash", true, DASH_VALUES),
      numberField("nominalIdIn", "* Nominal ID in / 公称内径英寸", true),
      numberField("idMm", "* ID mm / 内径毫米", true),
      numberField("odMm", "* OD mm / 外径毫米", true),
      numberField("workingBar", "* Working Pressure bar / 工作压力", true),
      numberField("workingPsi", "Working Pressure psi / 工作压力", false),
      numberField("burstBar", "* Minimum Burst bar / 最小爆破压力", true),
      numberField("bendRadiusMm", "* Min Bend Radius mm / 最小弯曲半径", true),
      numberField("weightKgM", "* Weight kg/m / 米重", true),
      numberField("tempMinC", "* Temp Min °C / 最低温度", true),
      numberField("tempMaxC", "* Temp Max °C / 最高温度", true),
      textField("tubeMaterial", "* Tube Material / 内胶材料", true),
      textField("reinforcement", "* Reinforcement / 增强层", true),
      textField("coverMaterial", "* Cover Material / 外胶材料", true),
      textField("coverColor", "* Cover Color / 外胶颜色", true),
      textField("coverFinish", "Cover Finish / 表面", false),
      textField(
        "skiveRequirement",
        "* Skive Requirement / 剥胶要求",
        true,
        SKIVE_REQUIREMENTS,
      ),
      textField("mshaMarking", "MSHA Marking / MSHA标识", false, YES_NO_NA),
      textField("fluidCompatibility", "* Fluid Compatibility / 介质兼容", true),
      textField("origin", "* Country of Origin / 原产国", true),
      textField("source", "* Source Document/Page / 来源文件页码", true),
      textField("notes", "Notes / 备注", false),
      statusFields.rfq,
      statusFields.technical,
    ],
  },
  {
    name: "02_压接接头",
    skuKey: "sku",
    fields: [
      statusFields.publication,
      textField("sku", "* Hose End SKU / 接头SKU", true),
      textField("fittingSeries", "* Fitting Series / 接头系列", true),
      textField(
        "competitorPartNumber",
        "Competitor Part No. / 竞品参考料号",
        false,
      ),
      textField("interfaceFamily", "* Interface Family / 接口体系", true, [
        "JIC 37°",
        "NPT",
        "NPTF",
        "ORFS",
        "BSPP",
        "BSPT",
        "Metric DIN",
        "SAE Flange",
        "Banjo",
        "Japanese",
        "Other",
        "ORB",
      ]),
      textField("connectionStandard", "* Interface Standard / 接口标准", true),
      textField("gender", "* Gender / 公母", true, ["Male", "Female", "N/A"]),
      textField("swivelForm", "* Swivel/Fixed / 旋转或固定", true, [
        "Fixed",
        "Swivel",
        "Live Swivel",
        "N/A",
      ]),
      textField("angle", "* Angle / 角度", true, [
        "0° Straight",
        "45°",
        "90°",
        "Other",
      ]),
      textField("sealingForm", "* Sealing Form / 密封形式", true),
      textField("thread", "* Thread / 螺纹", true),
      textField(
        "connectionDash",
        "* Connection Dash / 接口Dash",
        true,
        DASH_VALUES,
      ),
      textField(
        "hoseTailDash",
        "* Hose Tail Dash / 胶管尾Dash",
        true,
        DASH_VALUES,
      ),
      textField("material", "Material / 材质", false),
      textField("coating", "Coating / 表面处理", false, COATINGS),
      numberField("saltSprayHours", "Salt Spray h / 盐雾小时", false),
      numberField("maxWorkingBar", "Max Working bar / 最大工作压力", false),
      numberField("dimensionAMm", "Dimension A mm / 总长A", false),
      numberField("cutoffBMm", "Cut-off B mm / 扣除量B", false),
      numberField("hex1Mm", "Hex 1 mm / 六角1", false),
      numberField("hex2Mm", "Hex 2 mm / 六角2", false),
      numberField("minimumBoreMm", "Minimum Bore mm / 最小通径", false),
      numberField("unitWeightG", "Unit Weight g / 单重", false),
      textField("drawingNumber", "Drawing No. / 图纸号", false),
      textField("drawingRevision", "Drawing Rev / 图纸版本", false),
      textField("source", "* Source Document/Page / 来源", true),
      textField("notes", "Notes / 备注", false),
      statusFields.rfq,
      statusFields.technical,
    ],
  },
  {
    name: "03_套筒",
    skuKey: "sku",
    fields: [
      statusFields.publication,
      textField("sku", "* Ferrule SKU / 套筒SKU", true),
      textField("ferruleSeries", "* Ferrule Series / 套筒系列", true),
      textField("hoseConstruction", "* Hose Construction / 胶管结构", true),
      textField(
        "hoseTailDash",
        "* Hose Tail Dash / 胶管Dash",
        true,
        DASH_VALUES,
      ),
      textField(
        "skiveRequirement",
        "* Skive Requirement / 剥胶要求",
        true,
        SKIVE_REQUIREMENTS,
      ),
      textField("material", "* Material / 材质", true),
      textField("coating", "* Coating / 表面处理", true, COATINGS),
      textField("source", "* Source Document/Page / 来源", true),
      textField("notes", "Notes / 备注", false),
      statusFields.rfq,
      statusFields.technical,
    ],
  },
  {
    name: "04_兼容压接",
    skuKey: "hoseSku",
    fields: [
      statusFields.publication,
      textField("compatibilityId", "* Compatibility ID / 兼容编号", true),
      textField("hoseSku", "* Hose SKU / 胶管SKU", true),
      textField("hoseEndSku", "* Hose End SKU / 接头SKU", true),
      textField("ferruleSku", "* Ferrule SKU / 套筒SKU", true),
      textField("assemblyMethod", "Assembly Method / 装配方法", false),
      textField(
        "skiveRequirement",
        "Skive Requirement / 剥胶要求",
        false,
        SKIVE_REQUIREMENTS,
      ),
      numberField(
        "outerSkiveLengthMm",
        "Outer Skive Length mm / 外剥长度",
        false,
      ),
      numberField(
        "innerSkiveLengthMm",
        "Inner Skive Length mm / 内剥长度",
        false,
      ),
      numberField("insertionDepthMm", "Insertion Depth mm / 插入深度", false),
      textField("crimpProgram", "Crimp Program / 程序编号", false),
      numberField(
        "finalCrimpDiameterMm",
        "Final Crimp Diameter mm / 最终压径",
        false,
      ),
      numberField("toleranceMm", "Crimp Tolerance ±mm / 压径公差", false),
      textField(
        "measurementLocation",
        "Measurement Location / 测量位置",
        false,
      ),
      numberField(
        "assemblyWorkingBar",
        "Assembly Working bar / 总成工作压力",
        false,
      ),
      numberField("proofPressureBar", "Proof Pressure bar / 耐压压力", false),
      numberField("proofHoldSeconds", "Proof Hold Seconds / 保压秒数", false),
      textField(
        "qualificationId",
        "Type Qualification ID / 型式验证编号",
        false,
      ),
      textField(
        "qualificationStatus",
        "* Qualification Status / 验证状态",
        true,
        QUALIFICATION_STATUSES,
      ),
      statusFields.rfq,
      textField("referenceSystem", "Reference System / 参考系统", false),
      textField(
        "referenceHoseCode",
        "Reference Hose Code / 参考胶管型号",
        false,
      ),
      textField(
        "referenceAssemblyMethod",
        "Reference Assembly Method / 参考装配方法",
        false,
      ),
      numberField(
        "referenceCrimpDiameterMm",
        "Reference Crimp Diameter mm / 参考压径",
        false,
      ),
      numberField(
        "referenceToleranceMm",
        "Reference Tolerance ±mm / 参考公差",
        false,
      ),
      textField("referenceSource", "Reference Source / 参考来源", false),
      textField("notes", "Notes / 备注", false),
      statusFields.technical,
    ],
  },
] as const;

function fieldLabel(header: string) {
  return header.replace(/^\*\s*/, "");
}

function hasValue(value: CatalogWorkbookCell | undefined) {
  return value !== null && value !== undefined && value !== "";
}

function normalizedCell(value: CatalogWorkbookCell | undefined) {
  return typeof value === "string" ? value.trim() : (value ?? null);
}

function validateWorksheet(
  workbookSheets: CatalogWorkbookSheet[],
  contract: WorksheetContract,
  results: CatalogImportValidationResult[],
) {
  const sheet = workbookSheets.find(
    (candidate) => candidate.sheet === contract.name,
  );
  if (!sheet) {
    results.push({
      code: "missing_worksheet",
      field: "Worksheet",
      message: `Required worksheet ${contract.name} is missing`,
      row: 0,
      severity: "error",
      sku: null,
      worksheet: contract.name,
    });
    return [];
  }

  const header = sheet.data[3] ?? [];
  for (const [index, field] of contract.fields.entries()) {
    if (header[index] !== field.header) {
      results.push({
        code: "invalid_header",
        field: fieldLabel(field.header),
        message: `Expected column ${index + 1} to be "${field.header}"`,
        row: 4,
        severity: "error",
        sku: null,
        worksheet: contract.name,
      });
    }
  }

  const skuIndex = contract.fields.findIndex(
    (field) => field.key === contract.skuKey,
  );
  const parsed: ParsedRow[] = [];
  for (const [dataIndex, sourceRow] of sheet.data.slice(4).entries()) {
    if (!sourceRow.some(hasValue)) continue;
    const rowNumber = dataIndex + 5;
    const rawSku = normalizedCell(sourceRow[skuIndex]);
    const sku = typeof rawSku === "string" && rawSku !== "" ? rawSku : null;
    const values: Record<string, CatalogWorkbookCell> = {};

    for (const [columnIndex, field] of contract.fields.entries()) {
      const value = normalizedCell(sourceRow[columnIndex]);
      values[field.key] = value;
      if (field.required && !hasValue(value)) {
        results.push({
          code: "required",
          field: fieldLabel(field.header),
          message: "Required value is missing",
          row: rowNumber,
          severity: "error",
          sku,
          worksheet: contract.name,
        });
        continue;
      }
      if (!hasValue(value)) continue;
      if (
        field.kind === "number" &&
        (typeof value !== "number" || !Number.isFinite(value))
      ) {
        results.push({
          code: "invalid_number",
          field: fieldLabel(field.header),
          message: "Expected a number without a unit suffix",
          row: rowNumber,
          severity: "error",
          sku,
          worksheet: contract.name,
        });
      }
      if (field.kind === "text" && typeof value !== "string") {
        results.push({
          code: "invalid_text",
          field: fieldLabel(field.header),
          message: "Expected text",
          row: rowNumber,
          severity: "error",
          sku,
          worksheet: contract.name,
        });
      }
      if (
        field.controlledValues &&
        typeof value === "string" &&
        !field.controlledValues.includes(value)
      ) {
        results.push({
          code: "invalid_enum",
          field: fieldLabel(field.header),
          message: `Value "${value}" is not a controlled value`,
          row: rowNumber,
          severity: "error",
          sku,
          worksheet: contract.name,
        });
      }
    }

    parsed.push({ rowNumber, sku, values, worksheet: contract.name });
  }
  return parsed;
}

function stringValue<T extends string = string>(row: ParsedRow, key: string) {
  return row.values[key] as T;
}

function optionalString(row: ParsedRow, key: string) {
  return (row.values[key] as string | null) ?? null;
}

function numberValue(row: ParsedRow, key: string) {
  return row.values[key] as number;
}

function optionalNumber(row: ParsedRow, key: string) {
  return (row.values[key] as number | null) ?? null;
}

function duplicateResult(
  row: ParsedRow,
  field: string,
  code: string,
  message: string,
): CatalogImportValidationResult {
  return {
    code,
    field,
    message,
    row: row.rowNumber,
    severity: "error",
    sku: row.sku,
    worksheet: row.worksheet,
  };
}

function validateUniqueSkus(
  rows: ParsedRow[],
  results: CatalogImportValidationResult[],
) {
  const seen = new Map<string, ParsedRow>();
  for (const row of rows) {
    if (!row.sku) continue;
    if (seen.has(row.sku)) {
      results.push(
        duplicateResult(
          row,
          row.worksheet === "01_胶管主数据"
            ? "Hose SKU / 胶管SKU"
            : row.worksheet === "02_压接接头"
              ? "Hose End SKU / 接头SKU"
              : "Ferrule SKU / 套筒SKU",
          "duplicate_sku",
          `Duplicate SKU "${row.sku}"`,
        ),
      );
    } else {
      seen.set(row.sku, row);
    }
  }
}

function validateCompatibilityRelationships(
  compatibilityRows: ParsedRow[],
  productRows: ParsedRow[][],
  results: CatalogImportValidationResult[],
) {
  const [hoseRows, hoseEndRows, ferruleRows] = productRows;
  const hoseSkus = new Set(hoseRows.map((row) => row.sku));
  const hoseEndSkus = new Set(hoseEndRows.map((row) => row.sku));
  const ferruleSkus = new Set(ferruleRows.map((row) => row.sku));
  const compatibilityIds = new Set<string>();
  const tuples = new Set<string>();

  for (const row of compatibilityRows) {
    const compatibilityId = stringValue(row, "compatibilityId");
    const hoseSku = stringValue(row, "hoseSku");
    const hoseEndSku = stringValue(row, "hoseEndSku");
    const ferruleSku = stringValue(row, "ferruleSku");
    if (compatibilityIds.has(compatibilityId)) {
      results.push(
        duplicateResult(
          row,
          "Compatibility ID / 兼容编号",
          "duplicate_compatibility_id",
          `Duplicate Compatibility ID "${compatibilityId}"`,
        ),
      );
    }
    compatibilityIds.add(compatibilityId);

    const references = [
      [hoseSku, hoseSkus, "Hose SKU / 胶管SKU", "01_胶管主数据"],
      [hoseEndSku, hoseEndSkus, "Hose End SKU / 接头SKU", "02_压接接头"],
      [ferruleSku, ferruleSkus, "Ferrule SKU / 套筒SKU", "03_套筒"],
    ] as const;
    for (const [value, known, field, source] of references) {
      if (!known.has(value)) {
        results.push(
          duplicateResult(
            row,
            field,
            "broken_foreign_key",
            `Exact SKU "${value}" does not exist in ${source}`,
          ),
        );
      }
    }

    const tuple = JSON.stringify([hoseSku, hoseEndSku, ferruleSku]);
    if (tuples.has(tuple)) {
      results.push(
        duplicateResult(
          row,
          "Hose SKU + Hose End SKU + Ferrule SKU",
          "duplicate_compatibility_tuple",
          "Duplicate exact compatibility tuple",
        ),
      );
    }
    tuples.add(tuple);
  }
}

function toHoseVariant(row: ParsedRow): HoseVariantDraft {
  return {
    bendRadiusMm: numberValue(row, "bendRadiusMm"),
    burstBar: numberValue(row, "burstBar"),
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    coverColor: stringValue(row, "coverColor"),
    coverFinish: optionalString(row, "coverFinish"),
    coverMaterial: stringValue(row, "coverMaterial"),
    dash: stringValue(row, "dash"),
    equivalentStandard: optionalString(row, "equivalentStandard"),
    fluidCompatibility: stringValue(row, "fluidCompatibility"),
    hoseSeries: stringValue(row, "hoseSeries"),
    idMm: numberValue(row, "idMm"),
    mshaMarking: optionalString(row, "mshaMarking"),
    nominalIdIn: numberValue(row, "nominalIdIn"),
    notes: optionalString(row, "notes"),
    odMm: numberValue(row, "odMm"),
    origin: stringValue(row, "origin"),
    primaryStandard: stringValue(row, "primaryStandard"),
    reinforcement: stringValue(row, "reinforcement"),
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    skiveRequirement: stringValue(row, "skiveRequirement"),
    sku: stringValue(row, "sku"),
    source: stringValue(row, "source"),
    technicalDataStatus: stringValue<TechnicalDataStatus>(
      row,
      "technicalDataStatus",
    ),
    tempMaxC: numberValue(row, "tempMaxC"),
    tempMinC: numberValue(row, "tempMinC"),
    tubeMaterial: stringValue(row, "tubeMaterial"),
    weightKgM: numberValue(row, "weightKgM"),
    workingBar: numberValue(row, "workingBar"),
    workingPsi: optionalNumber(row, "workingPsi"),
  };
}

function toHoseEnd(row: ParsedRow): HoseEndDraft {
  return {
    angle: stringValue(row, "angle"),
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    coating: optionalString(row, "coating"),
    competitorPartNumber: optionalString(row, "competitorPartNumber"),
    connectionDash: stringValue(row, "connectionDash"),
    connectionStandard: stringValue(row, "connectionStandard"),
    cutoffBMm: optionalNumber(row, "cutoffBMm"),
    dimensionAMm: optionalNumber(row, "dimensionAMm"),
    drawingNumber: optionalString(row, "drawingNumber"),
    drawingRevision: optionalString(row, "drawingRevision"),
    fittingSeries: stringValue(row, "fittingSeries"),
    gender: stringValue(row, "gender"),
    hex1Mm: optionalNumber(row, "hex1Mm"),
    hex2Mm: optionalNumber(row, "hex2Mm"),
    hoseTailDash: stringValue(row, "hoseTailDash"),
    interfaceFamily: stringValue(row, "interfaceFamily"),
    material: optionalString(row, "material"),
    maxWorkingBar: optionalNumber(row, "maxWorkingBar"),
    minimumBoreMm: optionalNumber(row, "minimumBoreMm"),
    notes: optionalString(row, "notes"),
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    saltSprayHours: optionalNumber(row, "saltSprayHours"),
    sealingForm: stringValue(row, "sealingForm"),
    sku: stringValue(row, "sku"),
    source: stringValue(row, "source"),
    swivelForm: stringValue(row, "swivelForm"),
    technicalDataStatus: stringValue<TechnicalDataStatus>(
      row,
      "technicalDataStatus",
    ),
    thread: stringValue(row, "thread"),
    unitWeightG: optionalNumber(row, "unitWeightG"),
  };
}

function toFerrule(row: ParsedRow): FerruleDraft {
  return {
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    coating: stringValue(row, "coating"),
    ferruleSeries: stringValue(row, "ferruleSeries"),
    hoseConstruction: stringValue(row, "hoseConstruction"),
    hoseTailDash: stringValue(row, "hoseTailDash"),
    material: stringValue(row, "material"),
    notes: optionalString(row, "notes"),
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    skiveRequirement: stringValue(row, "skiveRequirement"),
    sku: stringValue(row, "sku"),
    source: stringValue(row, "source"),
    technicalDataStatus: stringValue<TechnicalDataStatus>(
      row,
      "technicalDataStatus",
    ),
  };
}

function toCompatibility(row: ParsedRow): CompatibilityDraft {
  const qualificationStatus = stringValue<QualificationStatus>(
    row,
    "qualificationStatus",
  );
  const technicalDataStatus = stringValue<TechnicalDataStatus>(
    row,
    "technicalDataStatus",
  );
  return {
    assemblyMethod: optionalString(row, "assemblyMethod"),
    assemblyWorkingBar: optionalNumber(row, "assemblyWorkingBar"),
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    compatibilityId: stringValue(row, "compatibilityId"),
    crimpProgram: optionalString(row, "crimpProgram"),
    ferruleSku: stringValue(row, "ferruleSku"),
    finalCrimpDiameterMm: optionalNumber(row, "finalCrimpDiameterMm"),
    hoseEndSku: stringValue(row, "hoseEndSku"),
    hoseSku: stringValue(row, "hoseSku"),
    innerSkiveLengthMm: optionalNumber(row, "innerSkiveLengthMm"),
    insertionDepthMm: optionalNumber(row, "insertionDepthMm"),
    measurementLocation: optionalString(row, "measurementLocation"),
    notes: optionalString(row, "notes"),
    outerSkiveLengthMm: optionalNumber(row, "outerSkiveLengthMm"),
    productionApprovalStatus:
      qualificationStatus === "Approved" && technicalDataStatus === "Complete"
        ? "approved"
        : "not_approved",
    proofHoldSeconds: optionalNumber(row, "proofHoldSeconds"),
    proofPressureBar: optionalNumber(row, "proofPressureBar"),
    qualificationId: optionalString(row, "qualificationId"),
    qualificationStatus,
    referenceAssemblyMethod: optionalString(row, "referenceAssemblyMethod"),
    referenceCrimpDiameterMm: optionalNumber(row, "referenceCrimpDiameterMm"),
    referenceHoseCode: optionalString(row, "referenceHoseCode"),
    referenceSource: optionalString(row, "referenceSource"),
    referenceSystem: optionalString(row, "referenceSystem"),
    referenceToleranceMm: optionalNumber(row, "referenceToleranceMm"),
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    skiveRequirement: optionalString(row, "skiveRequirement"),
    technicalDataStatus,
    toleranceMm: optionalNumber(row, "toleranceMm"),
  };
}

function toCatalogSku(
  sourceWorksheet: string,
  productType: CatalogSkuDraft["productType"],
  row: ParsedRow,
  hoseSeries: string | null,
): CatalogSkuDraft {
  return {
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    hoseSeries,
    productType,
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    sku: stringValue(row, "sku"),
    sourceWorksheet,
    supplyAvailability: "temporarily_unavailable",
    technicalDataStatus: stringValue<TechnicalDataStatus>(
      row,
      "technicalDataStatus",
    ),
  };
}

export function validateCatalogWorkbook(
  workbookSheets: CatalogWorkbookSheet[],
): CatalogWorkbookValidation {
  const validationResults: CatalogImportValidationResult[] = [];
  const rowsBySheet = WORKSHEET_CONTRACTS.map((contract) =>
    validateWorksheet(workbookSheets, contract, validationResults),
  );
  const [hoseRows, hoseEndRows, ferruleRows, compatibilityRows] = rowsBySheet;

  validateUniqueSkus(
    [...hoseRows, ...hoseEndRows, ...ferruleRows],
    validationResults,
  );
  validateCompatibilityRelationships(
    compatibilityRows,
    [hoseRows, hoseEndRows, ferruleRows],
    validationResults,
  );

  const blockingErrors = validationResults.filter(
    (result) => result.severity === "error",
  );
  if (blockingErrors.length > 0) {
    return { blockingErrors, draft: null, validationResults };
  }

  const hoseVariants = hoseRows.map(toHoseVariant);
  const hoseEnds = hoseEndRows.map(toHoseEnd);
  const ferrules = ferruleRows.map(toFerrule);
  return {
    blockingErrors,
    draft: {
      compatibilities: compatibilityRows.map(toCompatibility),
      ferrules,
      hoseEnds,
      hoseSeries: [
        ...new Set(hoseVariants.map((row) => row.hoseSeries)),
      ].sort(),
      hoseVariants,
      skus: [
        ...hoseRows.map((row) =>
          toCatalogSku(
            "01_胶管主数据",
            "hose",
            row,
            stringValue(row, "hoseSeries"),
          ),
        ),
        ...hoseEndRows.map((row) =>
          toCatalogSku("02_压接接头", "hose_end", row, null),
        ),
        ...ferruleRows.map((row) =>
          toCatalogSku("03_套筒", "ferrule", row, null),
        ),
      ],
    },
    validationResults,
  };
}
