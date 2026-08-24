import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
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
    index("catalog_hose_variants_series_dash_idx").on(
      table.importId,
      table.hoseSeries,
      table.dash,
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
    index("catalog_releases_status_created_at_idx").on(
      table.status,
      table.createdAt,
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
