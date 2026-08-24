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
  productType: "hose" | "hose_end" | "ferrule" | "adapter" | "quick_coupler";
  rfqEligibility: RfqEligibility;
  sku: string;
  sourceWorksheet: string;
  supplyAvailability: "temporarily_unavailable";
  technicalDataStatus: TechnicalDataStatus;
}

export interface AdapterFamilyDraft {
  adapterFamilyId: string;
  catalogModel: string;
  catalogPublicationStatus: CatalogPublicationStatus;
  connectionForm1: string;
  connectionForm2: string;
  connectionForm3: string | null;
  interface1: string;
  interface2: string;
  interface3: string | null;
  notes: string | null;
  rfqEligibility: RfqEligibility;
  shapeCode: string;
  size1: string | null;
  size2: string | null;
  size3: string | null;
  skuTemplate: string;
  source: string;
  technicalDataStatus: TechnicalDataStatus;
  websiteDisplay: string;
  websiteProductName: string;
}

export interface AdapterDraft extends AdapterFamilyDraft {
  sku: string;
}

export interface QuickCouplerDraft {
  bodyDash: string;
  bodyMaterial: string | null;
  bodySize: string;
  catalogPublicationStatus: CatalogPublicationStatus;
  coating: string | null;
  connectionMechanism: string;
  couplerSeries: string;
  drawingNumber: string | null;
  interchangeStandard: string;
  matingSeries: string;
  maxWorkingBar: number | null;
  minimumBurstBar: number | null;
  notes: string | null;
  overallLengthMm: number | null;
  portCode: string;
  portDash: string;
  portGender: string;
  portInterface: string;
  portThread: string;
  pressureDropBasis: string | null;
  ratedFlowLMin: number | null;
  rfqEligibility: RfqEligibility;
  role: string;
  sealMaterial: string | null;
  sku: string;
  skuRoleCode: string;
  skuStandardCode: string;
  source: string;
  technicalDataStatus: TechnicalDataStatus;
  tempMaxC: number | null;
  tempMinC: number | null;
  unitWeightG: number | null;
  valving: string;
}

export interface SalesOfferDraft {
  baseSku: string;
  catalogPublicationStatus: CatalogPublicationStatus;
  cartonGrossWeightKg: number | null;
  cartonHCm: number | null;
  cartonLCm: number | null;
  cartonWCm: number | null;
  continuousLengthConfirmation: string | null;
  countryOfOrigin: string;
  currency: "USD" | null;
  hsCode: string | null;
  innerPackQty: number | null;
  leadTimeDays: number;
  lengthIncrementFt: number | null;
  masterCartonQty: number | null;
  minimumLengthPerPieceFt: number | null;
  moq: number;
  netUnitWeightKg: number | null;
  notes: string | null;
  packageLengthFt: number | null;
  packingBasis: string | null;
  presetLength1Ft: number | null;
  presetLength2Ft: number | null;
  presetLength3Ft: number | null;
  productType: string;
  quantityInputMode: string;
  referencePriceUsd: number | null;
  rfqEligibility: RfqEligibility;
  salesSku: string;
  salesUnit: string;
  technicalDataStatus: TechnicalDataStatus;
  unitsPerSalesPack: number;
}

export interface CostBasisDraft {
  currency: "USD" | null;
  factoryUnitPrice: number | null;
  incotermPlace: string | null;
  priceIncoterm: string | null;
  salesSku: string;
  tierPrice: number | null;
  tierQty: number | null;
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
  adapterFamilies: AdapterFamilyDraft[];
  adapters: AdapterDraft[];
  compatibilities: CompatibilityDraft[];
  costBases: CostBasisDraft[];
  ferrules: FerruleDraft[];
  hoseEnds: HoseEndDraft[];
  hoseSeries: string[];
  hoseVariants: HoseVariantDraft[];
  quickCouplers: QuickCouplerDraft[];
  salesOffers: SalesOfferDraft[];
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
  {
    name: "05_过渡接头",
    skuKey: "adapterSku",
    fields: [
      statusFields.publication,
      textField(
        "adapterFamilyId",
        "* Adapter Family ID / 过渡接头系列编号",
        true,
      ),
      textField("adapterSku", "Adapter SKU / 过渡接头SKU", false),
      textField("skuTemplate", "* SKU Template / SKU编号模板", true),
      textField("catalogModel", "* Catalog Model / 目录型号", true),
      textField(
        "websiteProductName",
        "* Website Product Name / 网站产品名称",
        true,
      ),
      textField("shapeCode", "* Shape Code / 形状代码", true),
      textField("interface1", "* Interface 1 / 接口1", true),
      textField("connectionForm1", "* Connection Form 1 / 连接形式1", true),
      textField("size1", "Size 1 / 尺寸1", false),
      textField("interface2", "* Interface 2 / 接口2", true),
      textField("connectionForm2", "* Connection Form 2 / 连接形式2", true),
      textField("size2", "Size 2 / 尺寸2", false),
      textField("interface3", "Interface 3 / 接口3", false),
      textField("connectionForm3", "Connection Form 3 / 连接形式3", false),
      textField("size3", "Size 3 / 尺寸3", false),
      textField("websiteDisplay", "* Website Display / 网站展示", true),
      textField("source", "* Source Document/Page / 目录来源", true),
      textField("notes", "Notes / 备注", false),
      statusFields.rfq,
      statusFields.technical,
    ],
  },
  {
    name: "06_快速接头",
    skuKey: "sku",
    fields: [
      statusFields.publication,
      textField("sku", "* Quick Coupler SKU / 快接SKU", true),
      textField("couplerSeries", "* Coupler Series / 快接系列", true),
      textField("role", "* Role / 类型", true, [
        "Coupler/Socket",
        "Plug/Nipple",
        "Complete Pair",
      ]),
      textField("matingSeries", "* Mating Series / 配对系列", true),
      textField(
        "interchangeStandard",
        "* Interchange Standard / 互换标准",
        true,
      ),
      textField("bodySize", "* Body Size / 阀体尺寸", true),
      textField("portInterface", "* Port Interface / 端口接口", true),
      textField("portGender", "* Port Gender / 端口公母", true),
      textField("portThread", "* Port Thread / 端口螺纹", true),
      textField(
        "connectionMechanism",
        "* Connection Mechanism / 连接机构",
        true,
      ),
      textField("valving", "* Valving / 阀结构", true),
      textField("bodyMaterial", "Body Material / 主体材质", false),
      textField("coating", "Coating / 表面处理", false),
      textField("sealMaterial", "Seal Material / 密封材料", false),
      numberField("maxWorkingBar", "Max Working bar / 最大工作压力", false),
      numberField("minimumBurstBar", "Minimum Burst bar / 最小爆破压力", false),
      numberField("ratedFlowLMin", "Rated Flow L/min / 额定流量", false),
      textField("pressureDropBasis", "Pressure Drop Basis / 压降条件", false),
      numberField("tempMinC", "Temp Min °C / 最低温度", false),
      numberField("tempMaxC", "Temp Max °C / 最高温度", false),
      numberField("overallLengthMm", "Overall Length mm / 总长", false),
      numberField("unitWeightG", "Unit Weight g / 单重", false),
      textField("drawingNumber", "Drawing No. / 图纸号", false),
      textField("source", "* Source Document/Page / 来源", true),
      textField("notes", "Notes / 备注", false),
      statusFields.rfq,
      statusFields.technical,
    ],
  },
  {
    name: "07_价格包装",
    skuKey: "salesSku",
    fields: [
      statusFields.publication,
      textField("productType", "* Product Type / 产品类型", true, [
        "Hose Variant",
        "Hose End",
        "Ferrule",
        "Adapter",
        "Quick Coupler",
        "Quick Plug",
      ]),
      textField("baseSku", "* Base SKU / 基础SKU", true),
      textField("salesSku", "* Sales SKU / 销售SKU", true),
      textField("salesUnit", "* Sales Unit / 销售单位", true),
      numberField("packageLengthFt", "Package Length ft / 包装长度", false),
      numberField(
        "unitsPerSalesPack",
        "* Units per Sales Pack / 每销售包装数量",
        true,
      ),
      numberField("moq", "* MOQ / 最小起订量", true),
      numberField(
        "netUnitWeightKg",
        "Net Unit Weight kg / 单个销售单位净重",
        false,
      ),
      numberField("leadTimeDays", "* Lead Time days / 交期天数", true),
      textField("countryOfOrigin", "* Country of Origin / 原产国", true),
      textField("currency", "Currency / 币种", false, ["USD"]),
      numberField("factoryUnitPrice", "Factory Unit Price / 工厂单价", false),
      textField("priceIncoterm", "Price Incoterm / 采购价格条款", false),
      textField("incotermPlace", "Incoterm Place / 条款地点", false),
      numberField("tierQty", "Tier Qty / 阶梯数量", false),
      numberField("tierPrice", "Tier Price / 阶梯单价", false),
      numberField(
        "referencePriceUsd",
        "Retail Unit Price USD / 零售单价",
        false,
      ),
      numberField("innerPackQty", "Inner Pack Qty / 内包装数量", false),
      numberField("masterCartonQty", "Master Carton Qty / 每外箱数量", false),
      numberField(
        "cartonGrossWeightKg",
        "Carton Gross Weight kg / 整箱毛重",
        false,
      ),
      numberField("cartonLCm", "Carton L cm / 箱长", false),
      numberField("cartonWCm", "Carton W cm / 箱宽", false),
      numberField("cartonHCm", "Carton H cm / 箱高", false),
      textField("packingBasis", "Packing Basis / 装箱依据", false),
      textField("hsCode", "HS Code / 海关编码", false),
      textField("notes", "Notes / 备注", false),
      statusFields.rfq,
      statusFields.technical,
      textField(
        "quantityInputMode",
        "* Quantity Input Mode / 数量输入方式",
        true,
        ["Units", "Length x Pieces"],
      ),
      numberField(
        "minimumLengthPerPieceFt",
        "Minimum Length per Piece ft / 每根最小长度",
        false,
      ),
      numberField("lengthIncrementFt", "Length Increment ft / 长度步长", false),
      numberField("presetLength1Ft", "Preset Length 1 ft / 快捷长度1", false),
      numberField("presetLength2Ft", "Preset Length 2 ft / 快捷长度2", false),
      numberField("presetLength3Ft", "Preset Length 3 ft / 快捷长度3", false),
      textField(
        "continuousLengthConfirmation",
        "Continuous Length Confirmation / 连续长度确认",
        false,
      ),
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
              : row.worksheet === "03_套筒"
                ? "Ferrule SKU / 套筒SKU"
                : row.worksheet === "05_过渡接头"
                  ? "Adapter SKU / 过渡接头SKU"
                  : "Quick Coupler SKU / 快接SKU",
          "duplicate_sku",
          `Duplicate SKU "${row.sku}"`,
        ),
      );
    } else {
      seen.set(row.sku, row);
    }
  }
}

function normalizedDashToken(value: string) {
  const token = value.replace(/^-/, "");
  return token.padStart(2, "0");
}

function validateAdapterSkuConventions(
  rows: ParsedRow[],
  results: CatalogImportValidationResult[],
) {
  for (const row of rows) {
    if (!row.sku) continue;
    const size1 = optionalString(row, "size1");
    const size2 = optionalString(row, "size2");
    if (!size1 || !size2) {
      results.push(
        duplicateResult(
          row,
          !size1 ? "Size 1 / 尺寸1" : "Size 2 / 尺寸2",
          "adapter_sku_size_required",
          "A concrete Adapter SKU requires both Size 1 and Size 2",
        ),
      );
      continue;
    }
    const expected = [
      "ADP",
      stringValue(row, "shapeCode"),
      stringValue(row, "interface1"),
      stringValue(row, "connectionForm1"),
      normalizedDashToken(size1),
      stringValue(row, "interface2"),
      stringValue(row, "connectionForm2"),
      normalizedDashToken(size2),
    ].join("_");
    if (row.sku !== expected) {
      results.push(
        duplicateResult(
          row,
          "Adapter SKU / 过渡接头SKU",
          "invalid_adapter_sku",
          `Adapter SKU must be "${expected}" for the exact shape, interfaces, forms, and sizes`,
        ),
      );
    }
  }
}

const QUICK_COUPLER_ROLE_CODES = {
  "Complete Pair": "SET",
  "Coupler/Socket": "SOC",
  "Plug/Nipple": "PLG",
} as const;

const QUICK_COUPLER_STANDARD_CODES: Record<string, string> = {
  "ISO 16028": "16028",
  "ISO 5675": "5675",
  "ISO 7241-1 Series A": "7241A",
  "ISO 7241-1 Series B": "7241B",
};

function quickCouplerPortCode(row: ParsedRow) {
  const gender = stringValue(row, "portGender");
  const port = stringValue(row, "portInterface");
  const interfaceCode = port === "NPTF" ? "NPT" : port;
  return `${gender === "Female" ? "F" : gender === "Male" ? "M" : ""}${interfaceCode}`;
}

function quickCouplerSkuParts(row: ParsedRow) {
  const match = row.sku?.match(
    /^QDC_([^_]+)_([^_]+)_([0-9]{2})_([^_]+)_([0-9]{2})$/,
  );
  if (!match) return null;
  return {
    bodyDash: match[3],
    portCode: match[4],
    portDash: match[5],
    roleCode: match[2],
    standardCode: match[1],
  };
}

function bodySizeDash(bodySize: string) {
  const fractions: Record<string, string> = {
    "1/4 in": "04",
    "3/8 in": "06",
    "1/2 in": "08",
    "3/4 in": "12",
    "1 in": "16",
  };
  return fractions[bodySize] ?? null;
}

function portThreadDash(portThread: string, portInterface: string) {
  if (portInterface === "ORB" && portThread.startsWith("3/4-16")) return "08";
  const nominal = portThread.split("-")[0];
  return bodySizeDash(`${nominal} in`);
}

function validateQuickCouplerSkuConventions(
  rows: ParsedRow[],
  results: CatalogImportValidationResult[],
) {
  for (const row of rows) {
    const parts = quickCouplerSkuParts(row);
    const expected = {
      bodyDash: bodySizeDash(stringValue(row, "bodySize")),
      portCode: quickCouplerPortCode(row),
      portDash: portThreadDash(
        stringValue(row, "portThread"),
        stringValue(row, "portInterface"),
      ),
      roleCode:
        QUICK_COUPLER_ROLE_CODES[
          stringValue<keyof typeof QUICK_COUPLER_ROLE_CODES>(row, "role")
        ],
      standardCode:
        QUICK_COUPLER_STANDARD_CODES[stringValue(row, "interchangeStandard")] ??
        null,
    };
    if (
      !parts ||
      Object.entries(expected).some(
        ([key, value]) =>
          value === null || parts[key as keyof typeof parts] !== value,
      )
    ) {
      results.push(
        duplicateResult(
          row,
          "Quick Coupler SKU / 快接SKU",
          "invalid_quick_coupler_sku",
          "Quick Coupler SKU does not match its standard, role, Body Size, port, or Port Thread",
        ),
      );
    }
  }
}

function validatePriceRelationships(
  priceRows: ParsedRow[],
  productRows: ParsedRow[],
  results: CatalogImportValidationResult[],
) {
  const productsBySku = new Map(productRows.map((row) => [row.sku, row]));
  const productSkus = new Set(productsBySku.keys());
  const baseSkus = new Set<string>();
  const salesSkus = new Set<string>();
  const positiveIntegerFields = [
    ["unitsPerSalesPack", "Units per Sales Pack / 每销售包装数量"],
    ["moq", "MOQ / 最小起订量"],
    ["leadTimeDays", "Lead Time days / 交期天数"],
    ["tierQty", "Tier Qty / 阶梯数量"],
    ["innerPackQty", "Inner Pack Qty / 内包装数量"],
    ["masterCartonQty", "Master Carton Qty / 每外箱数量"],
  ] as const;
  const positiveNumberFields = [
    ["packageLengthFt", "Package Length ft / 包装长度"],
    ["netUnitWeightKg", "Net Unit Weight kg / 单个销售单位净重"],
    ["factoryUnitPrice", "Factory Unit Price / 工厂单价"],
    ["tierPrice", "Tier Price / 阶梯单价"],
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

  for (const row of priceRows) {
    const baseSku = stringValue(row, "baseSku");
    const salesSku = stringValue(row, "salesSku");
    for (const [value, field] of [
      [baseSku, "Base SKU / 基础SKU"],
      [salesSku, "Sales SKU / 销售SKU"],
    ] as const) {
      if (!productSkus.has(value)) {
        results.push(
          duplicateResult(
            row,
            field,
            "orphan_price_row",
            `Exact SKU "${value}" does not exist in worksheets 01, 02, 03, 05, or 06`,
          ),
        );
      }
    }

    const product = productsBySku.get(baseSku);
    if (product) {
      const expectedProductType =
        product.worksheet === "01_胶管主数据"
          ? "Hose Variant"
          : product.worksheet === "02_压接接头"
            ? "Hose End"
            : product.worksheet === "03_套筒"
              ? "Ferrule"
              : product.worksheet === "05_过渡接头"
                ? "Adapter"
                : stringValue(product, "role") === "Plug/Nipple"
                  ? "Quick Plug"
                  : "Quick Coupler";
      if (stringValue(row, "productType") !== expectedProductType) {
        results.push(
          duplicateResult(
            row,
            "Product Type / 产品类型",
            "price_product_type_mismatch",
            `Product Type must be "${expectedProductType}" for Base SKU "${baseSku}"`,
          ),
        );
      }

      for (const [key, field] of [
        [
          "catalogPublicationStatus",
          "Catalog Publication Status / 目录发布状态",
        ],
        ["rfqEligibility", "RFQ Eligibility / 询价资格"],
        ["technicalDataStatus", "Technical Data Status / 技术资料状态"],
      ] as const) {
        if (stringValue(row, key) !== stringValue(product, key)) {
          results.push(
            duplicateResult(
              row,
              field,
              "price_status_mismatch",
              `${field} must match Base SKU "${baseSku}"`,
            ),
          );
        }
      }
    }
    for (const [value, seen, field] of [
      [baseSku, baseSkus, "Base SKU / 基础SKU"],
      [salesSku, salesSkus, "Sales SKU / 销售SKU"],
    ] as const) {
      if (seen.has(value)) {
        results.push(
          duplicateResult(
            row,
            field,
            "duplicate_price_row",
            `Duplicate price row for "${value}"`,
          ),
        );
      }
      seen.add(value);
    }

    const currency = optionalString(row, "currency");
    const hasPrice =
      optionalNumber(row, "referencePriceUsd") !== null ||
      optionalNumber(row, "factoryUnitPrice") !== null ||
      optionalNumber(row, "tierPrice") !== null;
    if (hasPrice && currency !== "USD") {
      results.push(
        duplicateResult(
          row,
          "Currency / 币种",
          "price_currency_required",
          "Every Reference Price or Cost Basis value must be explicitly denominated in USD",
        ),
      );
    }

    for (const [key, field] of positiveIntegerFields) {
      const value = optionalNumber(row, key);
      if (value !== null && (!Number.isInteger(value) || value <= 0)) {
        results.push(
          duplicateResult(
            row,
            field,
            "invalid_positive_integer",
            `${field} must be a positive whole number when provided`,
          ),
        );
      }
    }
    for (const [key, field] of positiveNumberFields) {
      const value = optionalNumber(row, key);
      if (value !== null && value <= 0) {
        results.push(
          duplicateResult(
            row,
            field,
            "invalid_positive_number",
            `${field} must be greater than zero when provided`,
          ),
        );
      }
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
    sku: row.sku ?? stringValue(row, "sku"),
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

function toAdapterFamily(row: ParsedRow): AdapterFamilyDraft {
  return {
    adapterFamilyId: stringValue(row, "adapterFamilyId"),
    catalogModel: stringValue(row, "catalogModel"),
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    connectionForm1: stringValue(row, "connectionForm1"),
    connectionForm2: stringValue(row, "connectionForm2"),
    connectionForm3: optionalString(row, "connectionForm3"),
    interface1: stringValue(row, "interface1"),
    interface2: stringValue(row, "interface2"),
    interface3: optionalString(row, "interface3"),
    notes: optionalString(row, "notes"),
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    shapeCode: stringValue(row, "shapeCode"),
    size1: optionalString(row, "size1"),
    size2: optionalString(row, "size2"),
    size3: optionalString(row, "size3"),
    skuTemplate: stringValue(row, "skuTemplate"),
    source: stringValue(row, "source"),
    technicalDataStatus: stringValue<TechnicalDataStatus>(
      row,
      "technicalDataStatus",
    ),
    websiteDisplay: stringValue(row, "websiteDisplay"),
    websiteProductName: stringValue(row, "websiteProductName"),
  };
}

function toAdapter(row: ParsedRow): AdapterDraft {
  return { ...toAdapterFamily(row), sku: stringValue(row, "adapterSku") };
}

function toQuickCoupler(row: ParsedRow): QuickCouplerDraft {
  const parts = quickCouplerSkuParts(row);
  if (!parts)
    throw new Error(`Validated Quick Coupler SKU is invalid: ${row.sku}`);
  return {
    bodyDash: parts.bodyDash,
    bodyMaterial: optionalString(row, "bodyMaterial"),
    bodySize: stringValue(row, "bodySize"),
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    coating: optionalString(row, "coating"),
    connectionMechanism: stringValue(row, "connectionMechanism"),
    couplerSeries: stringValue(row, "couplerSeries"),
    drawingNumber: optionalString(row, "drawingNumber"),
    interchangeStandard: stringValue(row, "interchangeStandard"),
    matingSeries: stringValue(row, "matingSeries"),
    maxWorkingBar: optionalNumber(row, "maxWorkingBar"),
    minimumBurstBar: optionalNumber(row, "minimumBurstBar"),
    notes: optionalString(row, "notes"),
    overallLengthMm: optionalNumber(row, "overallLengthMm"),
    portCode: parts.portCode,
    portDash: parts.portDash,
    portGender: stringValue(row, "portGender"),
    portInterface: stringValue(row, "portInterface"),
    portThread: stringValue(row, "portThread"),
    pressureDropBasis: optionalString(row, "pressureDropBasis"),
    ratedFlowLMin: optionalNumber(row, "ratedFlowLMin"),
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    role: stringValue(row, "role"),
    sealMaterial: optionalString(row, "sealMaterial"),
    sku: stringValue(row, "sku"),
    skuRoleCode: parts.roleCode,
    skuStandardCode: parts.standardCode,
    source: stringValue(row, "source"),
    technicalDataStatus: stringValue<TechnicalDataStatus>(
      row,
      "technicalDataStatus",
    ),
    tempMaxC: optionalNumber(row, "tempMaxC"),
    tempMinC: optionalNumber(row, "tempMinC"),
    unitWeightG: optionalNumber(row, "unitWeightG"),
    valving: stringValue(row, "valving"),
  };
}

function toSalesOffer(row: ParsedRow): SalesOfferDraft {
  return {
    baseSku: stringValue(row, "baseSku"),
    catalogPublicationStatus: stringValue<CatalogPublicationStatus>(
      row,
      "catalogPublicationStatus",
    ),
    cartonGrossWeightKg: optionalNumber(row, "cartonGrossWeightKg"),
    cartonHCm: optionalNumber(row, "cartonHCm"),
    cartonLCm: optionalNumber(row, "cartonLCm"),
    cartonWCm: optionalNumber(row, "cartonWCm"),
    continuousLengthConfirmation: optionalString(
      row,
      "continuousLengthConfirmation",
    ),
    countryOfOrigin: stringValue(row, "countryOfOrigin"),
    currency: optionalString(row, "currency") as "USD" | null,
    hsCode: optionalString(row, "hsCode"),
    innerPackQty: optionalNumber(row, "innerPackQty"),
    leadTimeDays: numberValue(row, "leadTimeDays"),
    lengthIncrementFt: optionalNumber(row, "lengthIncrementFt"),
    masterCartonQty: optionalNumber(row, "masterCartonQty"),
    minimumLengthPerPieceFt: optionalNumber(row, "minimumLengthPerPieceFt"),
    moq: numberValue(row, "moq"),
    netUnitWeightKg: optionalNumber(row, "netUnitWeightKg"),
    notes: optionalString(row, "notes"),
    packageLengthFt: optionalNumber(row, "packageLengthFt"),
    packingBasis: optionalString(row, "packingBasis"),
    presetLength1Ft: optionalNumber(row, "presetLength1Ft"),
    presetLength2Ft: optionalNumber(row, "presetLength2Ft"),
    presetLength3Ft: optionalNumber(row, "presetLength3Ft"),
    productType: stringValue(row, "productType"),
    quantityInputMode: stringValue(row, "quantityInputMode"),
    referencePriceUsd: optionalNumber(row, "referencePriceUsd"),
    rfqEligibility: stringValue<RfqEligibility>(row, "rfqEligibility"),
    salesSku: stringValue(row, "salesSku"),
    salesUnit: stringValue(row, "salesUnit"),
    technicalDataStatus: stringValue<TechnicalDataStatus>(
      row,
      "technicalDataStatus",
    ),
    unitsPerSalesPack: numberValue(row, "unitsPerSalesPack"),
  };
}

function toCostBasis(row: ParsedRow): CostBasisDraft {
  return {
    currency: optionalString(row, "currency") as "USD" | null,
    factoryUnitPrice: optionalNumber(row, "factoryUnitPrice"),
    incotermPlace: optionalString(row, "incotermPlace"),
    priceIncoterm: optionalString(row, "priceIncoterm"),
    salesSku: stringValue(row, "salesSku"),
    tierPrice: optionalNumber(row, "tierPrice"),
    tierQty: optionalNumber(row, "tierQty"),
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
    sku: row.sku ?? stringValue(row, "sku"),
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
  const [
    hoseRows,
    hoseEndRows,
    ferruleRows,
    compatibilityRows,
    adapterRows,
    quickCouplerRows,
    priceRows,
  ] = rowsBySheet;
  const concreteAdapterRows = adapterRows.filter((row) => row.sku !== null);
  const adapterFamilyRows = adapterRows.filter((row) => row.sku === null);
  const productRows = [
    ...hoseRows,
    ...hoseEndRows,
    ...ferruleRows,
    ...concreteAdapterRows,
    ...quickCouplerRows,
  ];

  validateUniqueSkus(productRows, validationResults);
  validateCompatibilityRelationships(
    compatibilityRows,
    [hoseRows, hoseEndRows, ferruleRows],
    validationResults,
  );
  validateAdapterSkuConventions(concreteAdapterRows, validationResults);
  validateQuickCouplerSkuConventions(quickCouplerRows, validationResults);
  validatePriceRelationships(priceRows, productRows, validationResults);

  const blockingErrors = validationResults.filter(
    (result) => result.severity === "error",
  );
  if (blockingErrors.length > 0) {
    return { blockingErrors, draft: null, validationResults };
  }

  const hoseVariants = hoseRows.map(toHoseVariant);
  const hoseEnds = hoseEndRows.map(toHoseEnd);
  const ferrules = ferruleRows.map(toFerrule);
  const adapters = concreteAdapterRows.map(toAdapter);
  const quickCouplers = quickCouplerRows.map(toQuickCoupler);
  return {
    blockingErrors,
    draft: {
      adapterFamilies: adapterFamilyRows.map(toAdapterFamily),
      adapters,
      compatibilities: compatibilityRows.map(toCompatibility),
      costBases: priceRows.map(toCostBasis),
      ferrules,
      hoseEnds,
      hoseSeries: [
        ...new Set(hoseVariants.map((row) => row.hoseSeries)),
      ].sort(),
      hoseVariants,
      quickCouplers,
      salesOffers: priceRows.map(toSalesOffer),
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
        ...concreteAdapterRows.map((row) =>
          toCatalogSku("05_过渡接头", "adapter", row, null),
        ),
        ...quickCouplerRows.map((row) =>
          toCatalogSku("06_快速接头", "quick_coupler", row, null),
        ),
      ],
    },
    validationResults,
  };
}
