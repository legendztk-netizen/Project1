import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const applicationSchemaState = sqliteTable("application_schema_state", {
  singleton: integer("singleton").primaryKey(),
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const catalogImports = sqliteTable(
  "catalog_imports",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    sourceFileName: text("source_file_name"),
    sourceFileSizeBytes: integer("source_file_size_bytes"),
    summaryJson: text("summary_json").notNull().default("{}"),
    errorCount: integer("error_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    check(
      "catalog_import_kind",
      sql`${table.kind} in ('diagnostic', 'workbook')`,
    ),
    check(
      "catalog_import_status",
      sql`${table.status} in ('pending', 'completed', 'failed')`,
    ),
    index("catalog_imports_created_at_idx").on(table.createdAt),
  ],
);

export const catalogImportValidationResults = sqliteTable(
  "catalog_import_validation_results",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    worksheet: text("worksheet").notNull(),
    rowNumber: integer("row_number").notNull(),
    fieldName: text("field_name").notNull(),
    stableSku: text("stable_sku"),
    severity: text("severity").notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
  },
  (table) => [
    check(
      "catalog_import_validation_severity",
      sql`${table.severity} in ('error', 'warning')`,
    ),
    index("catalog_import_validation_import_idx").on(
      table.importId,
      table.rowNumber,
    ),
  ],
);

export const catalogSkus = sqliteTable(
  "catalog_skus",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    sourceWorksheet: text("source_worksheet").notNull(),
    productType: text("product_type").notNull(),
    hoseSeries: text("hose_series"),
    catalogPublicationStatus: text("catalog_publication_status").notNull(),
    rfqEligibility: text("rfq_eligibility").notNull(),
    technicalDataStatus: text("technical_data_status").notNull(),
    supplyAvailability: text("supply_availability").notNull(),
  },
  (table) => [
    check(
      "catalog_sku_product_type",
      sql`${table.productType} in ('hose', 'hose_end', 'ferrule', 'adapter', 'quick_coupler')`,
    ),
    check(
      "catalog_sku_supply_availability",
      sql`${table.supplyAvailability} in ('available_for_quote', 'temporarily_unavailable', 'discontinued')`,
    ),
    uniqueIndex("catalog_skus_import_sku_uq").on(table.importId, table.sku),
    index("catalog_skus_import_type_idx").on(table.importId, table.productType),
    index("catalog_skus_import_series_idx").on(
      table.importId,
      table.hoseSeries,
    ),
  ],
);

export const catalogHoseSeries = sqliteTable(
  "catalog_hose_series",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    seriesCode: text("series_code").notNull(),
    seriesName: text("series_name"),
    primaryStandard: text("primary_standard"),
    equivalentStandard: text("equivalent_standard"),
    tempMinC: real("temp_min_c"),
    tempMaxC: real("temp_max_c"),
    tubeMaterial: text("tube_material"),
    reinforcement: text("reinforcement"),
    coverMaterial: text("cover_material"),
    coverColor: text("cover_color"),
    coverFinish: text("cover_finish"),
    fluidCompatibility: text("fluid_compatibility"),
    representativeMediaVersionId: text("representative_media_version_id"),
  },
  (table) => [
    uniqueIndex("catalog_hose_series_import_code_uq").on(
      table.importId,
      table.seriesCode,
    ),
  ],
);

export const catalogHoseVariants = sqliteTable(
  "catalog_hose_variants",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    sku: text("sku").notNull(),
    hoseSeries: text("hose_series").notNull(),
    primaryStandard: text("primary_standard").notNull(),
    equivalentStandard: text("equivalent_standard"),
    dash: text("dash").notNull(),
    nominalIdIn: real("nominal_id_in").notNull(),
    idMm: real("id_mm").notNull(),
    odMm: real("od_mm").notNull(),
    workingBar: real("working_bar").notNull(),
    workingPsi: real("working_psi"),
    burstBar: real("burst_bar").notNull(),
    bendRadiusMm: real("bend_radius_mm").notNull(),
    weightKgM: real("weight_kg_m").notNull(),
    tempMinC: real("temp_min_c").notNull(),
    tempMaxC: real("temp_max_c").notNull(),
    tubeMaterial: text("tube_material").notNull(),
    reinforcement: text("reinforcement").notNull(),
    coverMaterial: text("cover_material").notNull(),
    coverColor: text("cover_color").notNull(),
    coverFinish: text("cover_finish"),
    skiveRequirement: text("skive_requirement").notNull(),
    mshaMarking: text("msha_marking"),
    fluidCompatibility: text("fluid_compatibility").notNull(),
    origin: text("origin").notNull(),
    source: text("source").notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("catalog_hose_variants_import_sku_uq").on(
      table.importId,
      table.sku,
    ),
    foreignKey({
      columns: [table.importId, table.sku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_hose_variants_catalog_sku_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.importId, table.hoseSeries],
      foreignColumns: [
        catalogHoseSeries.importId,
        catalogHoseSeries.seriesCode,
      ],
      name: "catalog_hose_variants_series_fk",
    }).onDelete("restrict"),
    index("catalog_hose_variants_series_dash_idx").on(
      table.importId,
      table.hoseSeries,
      table.dash,
    ),
  ],
);

export const catalogHoseEndSeries = sqliteTable(
  "catalog_hose_end_series",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    seriesCode: text("series_code").notNull(),
    seriesName: text("series_name").notNull(),
    interfaceFamily: text("interface_family").notNull(),
    connectionStandard: text("connection_standard").notNull(),
    gender: text("gender").notNull(),
    swivelForm: text("swivel_form").notNull(),
    angle: text("angle").notNull(),
    sealingForm: text("sealing_form").notNull(),
    representativeMediaVersionId: text("representative_media_version_id"),
  },
  (table) => [
    uniqueIndex("catalog_hose_end_series_import_code_uq").on(
      table.importId,
      table.seriesCode,
    ),
  ],
);

export const catalogHoseEnds = sqliteTable(
  "catalog_hose_ends",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    sku: text("sku").notNull(),
    fittingSeries: text("fitting_series").notNull(),
    competitorPartNumber: text("competitor_part_number"),
    interfaceFamily: text("interface_family").notNull(),
    connectionStandard: text("connection_standard").notNull(),
    gender: text("gender").notNull(),
    swivelForm: text("swivel_form").notNull(),
    angle: text("angle").notNull(),
    sealingForm: text("sealing_form").notNull(),
    thread: text("thread").notNull(),
    connectionDash: text("connection_dash").notNull(),
    hoseTailDash: text("hose_tail_dash").notNull(),
    material: text("material"),
    coating: text("coating"),
    saltSprayHours: real("salt_spray_hours"),
    maxWorkingBar: real("max_working_bar"),
    dimensionAMm: real("dimension_a_mm"),
    cutoffBMm: real("cutoff_b_mm"),
    hex1Mm: real("hex_1_mm"),
    hex2Mm: real("hex_2_mm"),
    minimumBoreMm: real("minimum_bore_mm"),
    unitWeightG: real("unit_weight_g"),
    drawingNumber: text("drawing_number"),
    drawingRevision: text("drawing_revision"),
    source: text("source").notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("catalog_hose_ends_import_sku_uq").on(
      table.importId,
      table.sku,
    ),
    foreignKey({
      columns: [table.importId, table.sku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_hose_ends_catalog_sku_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.importId, table.fittingSeries],
      foreignColumns: [
        catalogHoseEndSeries.importId,
        catalogHoseEndSeries.seriesCode,
      ],
      name: "catalog_hose_ends_series_fk",
    }).onDelete("restrict"),
    index("catalog_hose_ends_interface_idx").on(
      table.importId,
      table.interfaceFamily,
      table.connectionDash,
      table.hoseTailDash,
    ),
  ],
);

export const catalogFerrules = sqliteTable(
  "catalog_ferrules",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    sku: text("sku").notNull(),
    ferruleSeries: text("ferrule_series").notNull(),
    hoseConstruction: text("hose_construction").notNull(),
    hoseTailDash: text("hose_tail_dash").notNull(),
    skiveRequirement: text("skive_requirement").notNull(),
    material: text("material").notNull(),
    coating: text("coating").notNull(),
    source: text("source").notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("catalog_ferrules_import_sku_uq").on(table.importId, table.sku),
    foreignKey({
      columns: [table.importId, table.sku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_ferrules_catalog_sku_fk",
    }).onDelete("cascade"),
    index("catalog_ferrules_series_dash_idx").on(
      table.importId,
      table.ferruleSeries,
      table.hoseTailDash,
    ),
  ],
);

export const catalogAdapterFamilies = sqliteTable(
  "catalog_adapter_families",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    adapterFamilyId: text("adapter_family_id").notNull(),
    skuTemplate: text("sku_template").notNull(),
    catalogModel: text("catalog_model").notNull(),
    websiteProductName: text("website_product_name").notNull(),
    shapeCode: text("shape_code").notNull(),
    interface1: text("interface_1").notNull(),
    connectionForm1: text("connection_form_1").notNull(),
    size1: text("size_1"),
    interface2: text("interface_2").notNull(),
    connectionForm2: text("connection_form_2").notNull(),
    size2: text("size_2"),
    interface3: text("interface_3"),
    connectionForm3: text("connection_form_3"),
    size3: text("size_3"),
    websiteDisplay: text("website_display").notNull(),
    source: text("source").notNull(),
    notes: text("notes"),
    catalogPublicationStatus: text("catalog_publication_status").notNull(),
    rfqEligibility: text("rfq_eligibility").notNull(),
    technicalDataStatus: text("technical_data_status").notNull(),
  },
  (table) => [
    uniqueIndex("catalog_adapter_families_import_family_uq").on(
      table.importId,
      table.adapterFamilyId,
    ),
  ],
);

export const catalogAdapters = sqliteTable(
  "catalog_adapters",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    sku: text("sku").notNull(),
    adapterFamilyId: text("adapter_family_id").notNull(),
    skuTemplate: text("sku_template").notNull(),
    catalogModel: text("catalog_model").notNull(),
    websiteProductName: text("website_product_name").notNull(),
    shapeCode: text("shape_code").notNull(),
    interface1: text("interface_1").notNull(),
    connectionForm1: text("connection_form_1").notNull(),
    size1: text("size_1").notNull(),
    interface2: text("interface_2").notNull(),
    connectionForm2: text("connection_form_2").notNull(),
    size2: text("size_2").notNull(),
    interface3: text("interface_3"),
    connectionForm3: text("connection_form_3"),
    size3: text("size_3"),
    websiteDisplay: text("website_display").notNull(),
    source: text("source").notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("catalog_adapters_import_sku_uq").on(table.importId, table.sku),
    foreignKey({
      columns: [table.importId, table.sku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_adapters_catalog_sku_fk",
    }).onDelete("cascade"),
    index("catalog_adapters_interfaces_idx").on(
      table.importId,
      table.interface1,
      table.interface2,
      table.size1,
      table.size2,
    ),
  ],
);

export const catalogQuickCouplers = sqliteTable(
  "catalog_quick_couplers",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    sku: text("sku").notNull(),
    skuStandardCode: text("sku_standard_code").notNull(),
    skuRoleCode: text("sku_role_code").notNull(),
    bodyDash: text("body_dash").notNull(),
    portCode: text("port_code").notNull(),
    portDash: text("port_dash").notNull(),
    couplerSeries: text("coupler_series").notNull(),
    role: text("role").notNull(),
    matingSeries: text("mating_series").notNull(),
    interchangeStandard: text("interchange_standard").notNull(),
    bodySize: text("body_size").notNull(),
    portInterface: text("port_interface").notNull(),
    portGender: text("port_gender").notNull(),
    portThread: text("port_thread").notNull(),
    connectionMechanism: text("connection_mechanism").notNull(),
    valving: text("valving").notNull(),
    bodyMaterial: text("body_material"),
    coating: text("coating"),
    sealMaterial: text("seal_material"),
    maxWorkingBar: real("max_working_bar"),
    minimumBurstBar: real("minimum_burst_bar"),
    ratedFlowLMin: real("rated_flow_l_min"),
    pressureDropBasis: text("pressure_drop_basis"),
    tempMinC: real("temp_min_c"),
    tempMaxC: real("temp_max_c"),
    overallLengthMm: real("overall_length_mm"),
    unitWeightG: real("unit_weight_g"),
    drawingNumber: text("drawing_number"),
    source: text("source").notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("catalog_quick_couplers_import_sku_uq").on(
      table.importId,
      table.sku,
    ),
    foreignKey({
      columns: [table.importId, table.sku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_quick_couplers_catalog_sku_fk",
    }).onDelete("cascade"),
    index("catalog_quick_couplers_identity_idx").on(
      table.importId,
      table.interchangeStandard,
      table.role,
      table.bodyDash,
      table.portCode,
      table.portDash,
    ),
  ],
);

export const catalogSalesOffers = sqliteTable(
  "catalog_sales_offers",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    baseSku: text("base_sku").notNull(),
    salesSku: text("sales_sku").notNull(),
    productType: text("product_type").notNull(),
    salesUnit: text("sales_unit").notNull(),
    packageLengthFt: real("package_length_ft"),
    unitsPerSalesPack: real("units_per_sales_pack").notNull(),
    moq: real("moq").notNull(),
    netUnitWeightKg: real("net_unit_weight_kg"),
    leadTimeDays: real("lead_time_days").notNull(),
    countryOfOrigin: text("country_of_origin").notNull(),
    currency: text("currency"),
    referencePriceUsd: real("reference_price_usd"),
    innerPackQty: real("inner_pack_qty"),
    masterCartonQty: real("master_carton_qty"),
    cartonGrossWeightKg: real("carton_gross_weight_kg"),
    cartonLCm: real("carton_l_cm"),
    cartonWCm: real("carton_w_cm"),
    cartonHCm: real("carton_h_cm"),
    packingBasis: text("packing_basis"),
    hsCode: text("hs_code"),
    notes: text("notes"),
    catalogPublicationStatus: text("catalog_publication_status").notNull(),
    rfqEligibility: text("rfq_eligibility").notNull(),
    technicalDataStatus: text("technical_data_status").notNull(),
    quantityInputMode: text("quantity_input_mode").notNull(),
    minimumLengthPerPieceFt: real("minimum_length_per_piece_ft"),
    lengthIncrementFt: real("length_increment_ft"),
    presetLength1Ft: real("preset_length_1_ft"),
    presetLength2Ft: real("preset_length_2_ft"),
    presetLength3Ft: real("preset_length_3_ft"),
    continuousLengthConfirmation: text("continuous_length_confirmation"),
  },
  (table) => [
    uniqueIndex("catalog_sales_offers_import_base_sku_uq").on(
      table.importId,
      table.baseSku,
    ),
    uniqueIndex("catalog_sales_offers_import_sales_sku_uq").on(
      table.importId,
      table.salesSku,
    ),
    foreignKey({
      columns: [table.importId, table.baseSku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_sales_offers_catalog_sku_fk",
    }).onDelete("cascade"),
    index("catalog_sales_offers_public_price_idx").on(
      table.importId,
      table.referencePriceUsd,
    ),
  ],
);

export const catalogSeriesCommercialRules = sqliteTable(
  "catalog_series_commercial_rules",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    productType: text("product_type").notNull(),
    seriesCode: text("series_code").notNull(),
    salesUnit: text("sales_unit").notNull(),
    moq: real("moq").notNull(),
    leadTimeDays: real("lead_time_days").notNull(),
    countryOfOrigin: text("country_of_origin").notNull(),
    hsCode: text("hs_code"),
    notes: text("notes"),
    quantityInputMode: text("quantity_input_mode").notNull(),
    minimumLengthPerPieceFt: real("minimum_length_per_piece_ft"),
    lengthIncrementFt: real("length_increment_ft"),
    presetLength1Ft: real("preset_length_1_ft"),
    presetLength2Ft: real("preset_length_2_ft"),
    presetLength3Ft: real("preset_length_3_ft"),
    continuousLengthConfirmation: text("continuous_length_confirmation"),
  },
  (table) => [
    check(
      "catalog_series_commercial_rules_product_type",
      sql`${table.productType} in ('hose', 'hose_end', 'ferrule', 'adapter', 'quick_coupler')`,
    ),
    uniqueIndex("catalog_series_commercial_rules_import_series_uq").on(
      table.importId,
      table.productType,
      table.seriesCode,
    ),
  ],
);

export const catalogSkuPricePackaging = sqliteTable(
  "catalog_sku_price_packaging",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    sku: text("sku").notNull(),
    salesSku: text("sales_sku").notNull(),
    referencePriceUsd: real("reference_price_usd"),
    currency: text("currency").notNull().default("USD"),
    packageLengthFt: real("package_length_ft"),
    unitsPerSalesPack: real("units_per_sales_pack"),
    netUnitWeightKg: real("net_unit_weight_kg"),
    innerPackQty: real("inner_pack_qty"),
    masterCartonQty: real("master_carton_qty"),
    cartonGrossWeightKg: real("carton_gross_weight_kg"),
    cartonLCm: real("carton_l_cm"),
    cartonWCm: real("carton_w_cm"),
    cartonHCm: real("carton_h_cm"),
    packingBasis: text("packing_basis"),
  },
  (table) => [
    check(
      "catalog_sku_price_packaging_currency",
      sql`${table.currency} = 'USD'`,
    ),
    check(
      "catalog_sku_price_packaging_sales_sku",
      sql`${table.salesSku} = ${table.sku}`,
    ),
    uniqueIndex("catalog_sku_price_packaging_import_sku_uq").on(
      table.importId,
      table.sku,
    ),
    uniqueIndex("catalog_sku_price_packaging_import_sales_sku_uq").on(
      table.importId,
      table.salesSku,
    ),
    foreignKey({
      columns: [table.importId, table.sku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_sku_price_packaging_catalog_sku_fk",
    }).onDelete("cascade"),
    index("catalog_sku_price_packaging_public_price_idx").on(
      table.importId,
      table.referencePriceUsd,
    ),
  ],
);

export const catalogCostBases = sqliteTable(
  "catalog_cost_bases",
  {
    id: text("id").primaryKey(),
    importId: text("import_id").notNull(),
    salesSku: text("sales_sku").notNull(),
    currency: text("currency"),
    factoryUnitPrice: real("factory_unit_price"),
    priceIncoterm: text("price_incoterm"),
    incotermPlace: text("incoterm_place"),
    tierQty: real("tier_qty"),
    tierPrice: real("tier_price"),
  },
  (table) => [
    uniqueIndex("catalog_cost_bases_import_sales_sku_uq").on(
      table.importId,
      table.salesSku,
    ),
    foreignKey({
      columns: [table.importId, table.salesSku],
      foreignColumns: [
        catalogSalesOffers.importId,
        catalogSalesOffers.salesSku,
      ],
      name: "catalog_cost_bases_sales_offer_fk",
    }).onDelete("cascade"),
  ],
);

export const catalogCompatibilities = sqliteTable(
  "catalog_compatibilities",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    compatibilityId: text("compatibility_id").notNull(),
    hoseSku: text("hose_sku").notNull(),
    hoseEndSku: text("hose_end_sku").notNull(),
    ferruleSku: text("ferrule_sku").notNull(),
    catalogPublicationStatus: text("catalog_publication_status").notNull(),
    assemblyMethod: text("assembly_method"),
    skiveRequirement: text("skive_requirement"),
    outerSkiveLengthMm: real("outer_skive_length_mm"),
    innerSkiveLengthMm: real("inner_skive_length_mm"),
    insertionDepthMm: real("insertion_depth_mm"),
    crimpProgram: text("crimp_program"),
    finalCrimpDiameterMm: real("final_crimp_diameter_mm"),
    toleranceMm: real("tolerance_mm"),
    measurementLocation: text("measurement_location"),
    assemblyWorkingBar: real("assembly_working_bar"),
    proofPressureBar: real("proof_pressure_bar"),
    proofHoldSeconds: real("proof_hold_seconds"),
    qualificationId: text("qualification_id"),
    qualificationStatus: text("qualification_status").notNull(),
    rfqEligibility: text("rfq_eligibility").notNull(),
    referenceSystem: text("reference_system"),
    referenceHoseCode: text("reference_hose_code"),
    referenceAssemblyMethod: text("reference_assembly_method"),
    referenceCrimpDiameterMm: real("reference_crimp_diameter_mm"),
    referenceToleranceMm: real("reference_tolerance_mm"),
    referenceSource: text("reference_source"),
    notes: text("notes"),
    technicalDataStatus: text("technical_data_status").notNull(),
    productionApprovalStatus: text("production_approval_status").notNull(),
  },
  (table) => [
    check(
      "catalog_compatibility_production_approval",
      sql`${table.productionApprovalStatus} in ('approved', 'not_approved')`,
    ),
    uniqueIndex("catalog_compatibilities_import_id_uq").on(
      table.importId,
      table.compatibilityId,
    ),
    uniqueIndex("catalog_compatibilities_exact_tuple_uq").on(
      table.importId,
      table.hoseSku,
      table.hoseEndSku,
      table.ferruleSku,
    ),
    foreignKey({
      columns: [table.importId, table.hoseSku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_compatibilities_hose_sku_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.importId, table.hoseEndSku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_compatibilities_hose_end_sku_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.importId, table.ferruleSku],
      foreignColumns: [catalogSkus.importId, catalogSkus.sku],
      name: "catalog_compatibilities_ferrule_sku_fk",
    }).onDelete("cascade"),
    index("catalog_compatibilities_import_status_idx").on(
      table.importId,
      table.rfqEligibility,
      table.qualificationStatus,
    ),
  ],
);

export const catalogReleases = sqliteTable(
  "catalog_releases",
  {
    id: text("id").primaryKey(),
    releaseNumber: text("release_number").notNull(),
    status: text("status").notNull(),
    sourceImportId: text("source_import_id")
      .notNull()
      .references(() => catalogImports.id),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    check(
      "catalog_release_status",
      sql`${table.status} in ('draft', 'published', 'superseded')`,
    ),
    uniqueIndex("catalog_releases_release_number_uq").on(table.releaseNumber),
    uniqueIndex("catalog_releases_one_published_uq")
      .on(table.status)
      .where(sql`${table.status} = 'published'`),
    index("catalog_releases_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const catalogActiveRelease = sqliteTable(
  "catalog_active_release",
  {
    singleton: integer("singleton").primaryKey(),
    releaseId: text("release_id").references(() => catalogReleases.id),
    version: integer("version").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("catalog_active_release_singleton", sql`${table.singleton} = 1`),
  ],
);

export const configuratorRegistrySeedTemplates = sqliteTable(
  "configurator_registry_seed_templates",
  {
    registryType: text("registry_type").notNull(),
    entryKey: text("entry_key").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.registryType, table.entryKey],
      name: "configurator_registry_seed_templates_pk",
    }),
    check(
      "configurator_seed_registry_type",
      sql`${table.registryType} in ('endpoint_class', 'endpoint_assignment', 'measurement_method', 'measurement_mapping', 'clocking_convention', 'installed_protection', 'protection_rule', 'assembly_estimate_schedule')`,
    ),
  ],
);

export const catalogConfiguratorRegistryEntries = sqliteTable(
  "catalog_configurator_registry_entries",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => catalogReleases.id),
    registryType: text("registry_type").notNull(),
    entryKey: text("entry_key").notNull(),
    payloadJson: text("payload_json").notNull(),
    recordVersion: integer("record_version").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.releaseId, table.registryType, table.entryKey],
      name: "catalog_configurator_registry_entries_pk",
    }),
    check(
      "catalog_configurator_registry_type",
      sql`${table.registryType} in ('endpoint_class', 'endpoint_assignment', 'measurement_method', 'measurement_mapping', 'clocking_convention', 'installed_protection', 'protection_rule', 'assembly_estimate_schedule')`,
    ),
    index("catalog_configurator_registry_release_type_idx").on(
      table.releaseId,
      table.registryType,
    ),
  ],
);

export const catalogReleasePublications = sqliteTable(
  "catalog_release_publications",
  {
    releaseId: text("release_id")
      .primaryKey()
      .references(() => catalogReleases.id),
    previousReleaseId: text("previous_release_id").references(
      () => catalogReleases.id,
    ),
    expectedActiveVersion: integer("expected_active_version").notNull(),
    expectedDraftVersion: integer("expected_draft_version").notNull(),
    expectedAssemblyInputFingerprint: text(
      "expected_assembly_input_fingerprint",
    ),
    expectedAssemblyGenerationId: text("expected_assembly_generation_id"),
    expectedDerivedSeriesCount: integer("expected_derived_series_count"),
    expectedDerivedCombinationCount: integer(
      "expected_derived_combination_count",
    ),
    publishedBy: text("published_by").notNull(),
    requestCorrelationId: text("request_correlation_id").notNull(),
    publishedAt: text("published_at").notNull(),
    summaryJson: text("summary_json"),
  },
  (table) => [
    uniqueIndex("catalog_release_publications_request_uq").on(
      table.requestCorrelationId,
    ),
  ],
);

export const catalogAssemblyImpactAnalyses = sqliteTable(
  "catalog_assembly_impact_analyses",
  {
    releaseId: text("release_id")
      .primaryKey()
      .references(() => catalogReleases.id, { onDelete: "cascade" }),
    baselineReleaseId: text("baseline_release_id").references(
      () => catalogReleases.id,
    ),
    activeGeneration: integer("active_generation").notNull(),
    sharedRuleFingerprint: text("shared_rule_fingerprint").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    affectedSeriesJson: text("affected_series_json").notNull(),
    sourceChangesJson: text("source_changes_json").notNull(),
    status: text("status").notNull(),
    calculatedAt: text("calculated_at").notNull(),
    calculatedBy: text("calculated_by").notNull(),
    lastCalculationId: text("last_calculation_id").notNull(),
  },
  (table) => [
    check(
      "catalog_assembly_impact_status",
      sql`${table.status} in ('current', 'stale')`,
    ),
    uniqueIndex("catalog_assembly_impact_calculation_uq").on(
      table.lastCalculationId,
    ),
    index("catalog_assembly_impact_status_idx").on(
      table.status,
      table.releaseId,
    ),
  ],
);

export const catalogDerivedAssemblySeries = sqliteTable(
  "catalog_derived_assembly_series",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => catalogReleases.id, { onDelete: "cascade" }),
    sourceImportId: text("source_import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    hoseSeries: text("hose_series").notNull(),
    generationId: text("generation_id").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    combinationCount: integer("combination_count").notNull(),
    generatedAt: text("generated_at").notNull(),
    generatedBy: text("generated_by").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.releaseId, table.hoseSeries],
      name: "catalog_derived_assembly_series_pk",
    }),
    check(
      "catalog_derived_assembly_series_count",
      sql`${table.combinationCount} >= 0`,
    ),
    index("catalog_derived_assembly_series_generation_idx").on(
      table.releaseId,
      table.generationId,
    ),
  ],
);

export const catalogDerivedAssemblyCombinations = sqliteTable(
  "catalog_derived_assembly_combinations",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id").notNull(),
    sourceImportId: text("source_import_id").notNull(),
    hoseSeries: text("hose_series").notNull(),
    hoseSku: text("hose_sku").notNull(),
    endACompatibilityId: text("end_a_compatibility_id").notNull(),
    endAHoseEndSku: text("end_a_hose_end_sku").notNull(),
    endAFerruleSku: text("end_a_ferrule_sku").notNull(),
    endBCompatibilityId: text("end_b_compatibility_id").notNull(),
    endBHoseEndSku: text("end_b_hose_end_sku").notNull(),
    endBFerruleSku: text("end_b_ferrule_sku").notNull(),
    endARelationshipFingerprint: text(
      "end_a_relationship_fingerprint",
    ).notNull(),
    endBRelationshipFingerprint: text(
      "end_b_relationship_fingerprint",
    ).notNull(),
    combinationFingerprint: text("combination_fingerprint").notNull(),
    generatedAt: text("generated_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.releaseId, table.hoseSeries],
      foreignColumns: [
        catalogDerivedAssemblySeries.releaseId,
        catalogDerivedAssemblySeries.hoseSeries,
      ],
      name: "catalog_derived_assembly_combination_series_fk",
    }).onDelete("cascade"),
    uniqueIndex("catalog_derived_assembly_combination_tuple_uq").on(
      table.releaseId,
      table.hoseSku,
      table.endACompatibilityId,
      table.endBCompatibilityId,
    ),
    index("catalog_derived_assembly_combinations_series_idx").on(
      table.releaseId,
      table.hoseSeries,
    ),
  ],
);

export const catalogAssemblyRegenerations = sqliteTable(
  "catalog_assembly_regenerations",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id")
      .notNull()
      .references(() => catalogReleases.id, { onDelete: "cascade" }),
    inputFingerprint: text("input_fingerprint").notNull(),
    affectedSeriesJson: text("affected_series_json").notNull(),
    status: text("status").notNull(),
    additionCount: integer("addition_count").notNull().default(0),
    changeCount: integer("change_count").notNull().default(0),
    removalCount: integer("removal_count").notNull().default(0),
    combinationCount: integer("combination_count").notNull().default(0),
    actorId: text("actor_id").notNull(),
    occurredAt: text("occurred_at").notNull(),
    errorJson: text("error_json"),
  },
  (table) => [
    check(
      "catalog_assembly_regeneration_status",
      sql`${table.status} in ('succeeded', 'failed', 'already_current')`,
    ),
    check(
      "catalog_assembly_regeneration_counts",
      sql`${table.additionCount} >= 0 AND ${table.changeCount} >= 0 AND ${table.removalCount} >= 0`,
    ),
    index("catalog_assembly_regenerations_release_idx").on(
      table.releaseId,
      table.occurredAt,
    ),
  ],
);

export const adminAuditEvents = sqliteTable(
  "admin_audit_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actorId: text("actor_id").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    index("admin_audit_events_entity_idx").on(table.entityType, table.entityId),
    index("admin_audit_events_occurred_at_idx").on(table.occurredAt),
  ],
);
