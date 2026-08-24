import { getTableColumns, getTableName, type Table } from "drizzle-orm";

import type {
  CatalogImportSummary,
  CatalogWorkbookImportRepository,
  CatalogWorkbookImportReview,
  SaveFailedCatalogImportOperation,
  SaveValidatedCatalogDraftOperation,
} from "../domain/catalog-workbook-import";
import type {
  AdapterDraft,
  AdapterFamilyDraft,
  CatalogImportValidationResult,
  CatalogSkuDraft,
  CompatibilityDraft,
  CostBasisDraft,
  FerruleDraft,
  HoseEndDraft,
  HoseVariantDraft,
  QuickCouplerDraft,
  SalesOfferDraft,
} from "../domain/catalog-workbook";
import {
  catalogAdapterFamilies,
  catalogAdapters,
  catalogCompatibilities,
  catalogCostBases,
  catalogFerrules,
  catalogHoseEnds,
  catalogHoseSeries,
  catalogHoseVariants,
  catalogImportValidationResults,
  catalogQuickCouplers,
  catalogSalesOffers,
  catalogSkus,
} from "./database-schema";

type PersistedRow<T> = T & { id: string; importId: string };
type ColumnMapping<TRow> = readonly [
  property: Extract<keyof TRow, string>,
  column: string,
];

interface HoseSeriesRow {
  id: string;
  importId: string;
  seriesCode: string;
}

interface ValidationRow {
  code: CatalogImportValidationResult["code"];
  fieldName: CatalogImportValidationResult["field"];
  id: string;
  importId: string;
  message: CatalogImportValidationResult["message"];
  rowNumber: CatalogImportValidationResult["row"];
  severity: CatalogImportValidationResult["severity"];
  stableSku: CatalogImportValidationResult["sku"];
  worksheet: CatalogImportValidationResult["worksheet"];
}

function parseCatalogImportSummary(value: string): CatalogImportSummary {
  const decoded: unknown = JSON.parse(value);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Catalog import summary must be an object");
  }

  const summary = decoded as Record<string, unknown>;
  const count = (key: keyof CatalogImportSummary, legacyDefault = false) => {
    const count = summary[key];
    if (legacyDefault && count === undefined) return 0;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`Catalog import summary has an invalid ${key}`);
    }
    return count;
  };
  return {
    adapterCount: count("adapterCount", true),
    adapterFamilyCount: count("adapterFamilyCount", true),
    compatibilityCount: count("compatibilityCount"),
    costBasisPriceCount: count("costBasisPriceCount", true),
    ferruleCount: count("ferruleCount"),
    hoseEndCount: count("hoseEndCount"),
    hoseSeriesCount: count("hoseSeriesCount"),
    hoseVariantCount: count("hoseVariantCount"),
    quickCouplerCount: count("quickCouplerCount", true),
    referencePriceCount: count("referencePriceCount", true),
    salesOfferCount: count("salesOfferCount", true),
    skuCount: count("skuCount"),
  };
}

const skuColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["sku", "sku"],
  ["sourceWorksheet", "source_worksheet"],
  ["productType", "product_type"],
  ["hoseSeries", "hose_series"],
  ["catalogPublicationStatus", "catalog_publication_status"],
  ["rfqEligibility", "rfq_eligibility"],
  ["technicalDataStatus", "technical_data_status"],
  ["supplyAvailability", "supply_availability"],
] as const satisfies readonly ColumnMapping<PersistedRow<CatalogSkuDraft>>[];

const hoseVariantColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["sku", "sku"],
  ["hoseSeries", "hose_series"],
  ["primaryStandard", "primary_standard"],
  ["equivalentStandard", "equivalent_standard"],
  ["dash", "dash"],
  ["nominalIdIn", "nominal_id_in"],
  ["idMm", "id_mm"],
  ["odMm", "od_mm"],
  ["workingBar", "working_bar"],
  ["workingPsi", "working_psi"],
  ["burstBar", "burst_bar"],
  ["bendRadiusMm", "bend_radius_mm"],
  ["weightKgM", "weight_kg_m"],
  ["tempMinC", "temp_min_c"],
  ["tempMaxC", "temp_max_c"],
  ["tubeMaterial", "tube_material"],
  ["reinforcement", "reinforcement"],
  ["coverMaterial", "cover_material"],
  ["coverColor", "cover_color"],
  ["coverFinish", "cover_finish"],
  ["skiveRequirement", "skive_requirement"],
  ["mshaMarking", "msha_marking"],
  ["fluidCompatibility", "fluid_compatibility"],
  ["origin", "origin"],
  ["source", "source"],
  ["notes", "notes"],
] as const satisfies readonly ColumnMapping<PersistedRow<HoseVariantDraft>>[];

const hoseEndColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["sku", "sku"],
  ["fittingSeries", "fitting_series"],
  ["competitorPartNumber", "competitor_part_number"],
  ["interfaceFamily", "interface_family"],
  ["connectionStandard", "connection_standard"],
  ["gender", "gender"],
  ["swivelForm", "swivel_form"],
  ["angle", "angle"],
  ["sealingForm", "sealing_form"],
  ["thread", "thread"],
  ["connectionDash", "connection_dash"],
  ["hoseTailDash", "hose_tail_dash"],
  ["material", "material"],
  ["coating", "coating"],
  ["saltSprayHours", "salt_spray_hours"],
  ["maxWorkingBar", "max_working_bar"],
  ["dimensionAMm", "dimension_a_mm"],
  ["cutoffBMm", "cutoff_b_mm"],
  ["hex1Mm", "hex_1_mm"],
  ["hex2Mm", "hex_2_mm"],
  ["minimumBoreMm", "minimum_bore_mm"],
  ["unitWeightG", "unit_weight_g"],
  ["drawingNumber", "drawing_number"],
  ["drawingRevision", "drawing_revision"],
  ["source", "source"],
  ["notes", "notes"],
] as const satisfies readonly ColumnMapping<PersistedRow<HoseEndDraft>>[];

const ferruleColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["sku", "sku"],
  ["ferruleSeries", "ferrule_series"],
  ["hoseConstruction", "hose_construction"],
  ["hoseTailDash", "hose_tail_dash"],
  ["skiveRequirement", "skive_requirement"],
  ["material", "material"],
  ["coating", "coating"],
  ["source", "source"],
  ["notes", "notes"],
] as const satisfies readonly ColumnMapping<PersistedRow<FerruleDraft>>[];

const compatibilityColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["compatibilityId", "compatibility_id"],
  ["hoseSku", "hose_sku"],
  ["hoseEndSku", "hose_end_sku"],
  ["ferruleSku", "ferrule_sku"],
  ["catalogPublicationStatus", "catalog_publication_status"],
  ["assemblyMethod", "assembly_method"],
  ["skiveRequirement", "skive_requirement"],
  ["outerSkiveLengthMm", "outer_skive_length_mm"],
  ["innerSkiveLengthMm", "inner_skive_length_mm"],
  ["insertionDepthMm", "insertion_depth_mm"],
  ["crimpProgram", "crimp_program"],
  ["finalCrimpDiameterMm", "final_crimp_diameter_mm"],
  ["toleranceMm", "tolerance_mm"],
  ["measurementLocation", "measurement_location"],
  ["assemblyWorkingBar", "assembly_working_bar"],
  ["proofPressureBar", "proof_pressure_bar"],
  ["proofHoldSeconds", "proof_hold_seconds"],
  ["qualificationId", "qualification_id"],
  ["qualificationStatus", "qualification_status"],
  ["rfqEligibility", "rfq_eligibility"],
  ["referenceSystem", "reference_system"],
  ["referenceHoseCode", "reference_hose_code"],
  ["referenceAssemblyMethod", "reference_assembly_method"],
  ["referenceCrimpDiameterMm", "reference_crimp_diameter_mm"],
  ["referenceToleranceMm", "reference_tolerance_mm"],
  ["referenceSource", "reference_source"],
  ["notes", "notes"],
  ["technicalDataStatus", "technical_data_status"],
  ["productionApprovalStatus", "production_approval_status"],
] as const satisfies readonly ColumnMapping<PersistedRow<CompatibilityDraft>>[];

const adapterFamilyColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["adapterFamilyId", "adapter_family_id"],
  ["skuTemplate", "sku_template"],
  ["catalogModel", "catalog_model"],
  ["websiteProductName", "website_product_name"],
  ["shapeCode", "shape_code"],
  ["interface1", "interface_1"],
  ["connectionForm1", "connection_form_1"],
  ["size1", "size_1"],
  ["interface2", "interface_2"],
  ["connectionForm2", "connection_form_2"],
  ["size2", "size_2"],
  ["interface3", "interface_3"],
  ["connectionForm3", "connection_form_3"],
  ["size3", "size_3"],
  ["websiteDisplay", "website_display"],
  ["source", "source"],
  ["notes", "notes"],
  ["catalogPublicationStatus", "catalog_publication_status"],
  ["rfqEligibility", "rfq_eligibility"],
  ["technicalDataStatus", "technical_data_status"],
] as const satisfies readonly ColumnMapping<PersistedRow<AdapterFamilyDraft>>[];

const adapterColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["sku", "sku"],
  ["adapterFamilyId", "adapter_family_id"],
  ["skuTemplate", "sku_template"],
  ["catalogModel", "catalog_model"],
  ["websiteProductName", "website_product_name"],
  ["shapeCode", "shape_code"],
  ["interface1", "interface_1"],
  ["connectionForm1", "connection_form_1"],
  ["size1", "size_1"],
  ["interface2", "interface_2"],
  ["connectionForm2", "connection_form_2"],
  ["size2", "size_2"],
  ["interface3", "interface_3"],
  ["connectionForm3", "connection_form_3"],
  ["size3", "size_3"],
  ["websiteDisplay", "website_display"],
  ["source", "source"],
  ["notes", "notes"],
] as const satisfies readonly ColumnMapping<PersistedRow<AdapterDraft>>[];

const quickCouplerColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["sku", "sku"],
  ["skuStandardCode", "sku_standard_code"],
  ["skuRoleCode", "sku_role_code"],
  ["bodyDash", "body_dash"],
  ["portCode", "port_code"],
  ["portDash", "port_dash"],
  ["couplerSeries", "coupler_series"],
  ["role", "role"],
  ["matingSeries", "mating_series"],
  ["interchangeStandard", "interchange_standard"],
  ["bodySize", "body_size"],
  ["portInterface", "port_interface"],
  ["portGender", "port_gender"],
  ["portThread", "port_thread"],
  ["connectionMechanism", "connection_mechanism"],
  ["valving", "valving"],
  ["bodyMaterial", "body_material"],
  ["coating", "coating"],
  ["sealMaterial", "seal_material"],
  ["maxWorkingBar", "max_working_bar"],
  ["minimumBurstBar", "minimum_burst_bar"],
  ["ratedFlowLMin", "rated_flow_l_min"],
  ["pressureDropBasis", "pressure_drop_basis"],
  ["tempMinC", "temp_min_c"],
  ["tempMaxC", "temp_max_c"],
  ["overallLengthMm", "overall_length_mm"],
  ["unitWeightG", "unit_weight_g"],
  ["drawingNumber", "drawing_number"],
  ["source", "source"],
  ["notes", "notes"],
] as const satisfies readonly ColumnMapping<PersistedRow<QuickCouplerDraft>>[];

const salesOfferColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["baseSku", "base_sku"],
  ["salesSku", "sales_sku"],
  ["productType", "product_type"],
  ["salesUnit", "sales_unit"],
  ["packageLengthFt", "package_length_ft"],
  ["unitsPerSalesPack", "units_per_sales_pack"],
  ["moq", "moq"],
  ["netUnitWeightKg", "net_unit_weight_kg"],
  ["leadTimeDays", "lead_time_days"],
  ["countryOfOrigin", "country_of_origin"],
  ["currency", "currency"],
  ["referencePriceUsd", "reference_price_usd"],
  ["innerPackQty", "inner_pack_qty"],
  ["masterCartonQty", "master_carton_qty"],
  ["cartonGrossWeightKg", "carton_gross_weight_kg"],
  ["cartonLCm", "carton_l_cm"],
  ["cartonWCm", "carton_w_cm"],
  ["cartonHCm", "carton_h_cm"],
  ["packingBasis", "packing_basis"],
  ["hsCode", "hs_code"],
  ["notes", "notes"],
  ["catalogPublicationStatus", "catalog_publication_status"],
  ["rfqEligibility", "rfq_eligibility"],
  ["technicalDataStatus", "technical_data_status"],
  ["quantityInputMode", "quantity_input_mode"],
  ["minimumLengthPerPieceFt", "minimum_length_per_piece_ft"],
  ["lengthIncrementFt", "length_increment_ft"],
  ["presetLength1Ft", "preset_length_1_ft"],
  ["presetLength2Ft", "preset_length_2_ft"],
  ["presetLength3Ft", "preset_length_3_ft"],
  ["continuousLengthConfirmation", "continuous_length_confirmation"],
] as const satisfies readonly ColumnMapping<PersistedRow<SalesOfferDraft>>[];

const costBasisColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["salesSku", "sales_sku"],
  ["currency", "currency"],
  ["factoryUnitPrice", "factory_unit_price"],
  ["priceIncoterm", "price_incoterm"],
  ["incotermPlace", "incoterm_place"],
  ["tierQty", "tier_qty"],
  ["tierPrice", "tier_price"],
] as const satisfies readonly ColumnMapping<PersistedRow<CostBasisDraft>>[];

const validationColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["worksheet", "worksheet"],
  ["rowNumber", "row_number"],
  ["fieldName", "field_name"],
  ["stableSku", "stable_sku"],
  ["severity", "severity"],
  ["code", "code"],
  ["message", "message"],
] as const satisfies readonly ColumnMapping<ValidationRow>[];

const hoseSeriesColumns = [
  ["id", "id"],
  ["importId", "import_id"],
  ["seriesCode", "series_code"],
] as const satisfies readonly ColumnMapping<HoseSeriesRow>[];

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function jsonInsertStatement<TRow>(
  database: D1Database,
  table: Table,
  columns: readonly ColumnMapping<TRow>[],
  rows: TRow[],
) {
  const tableName = getTableName(table);
  const knownColumnNames = new Set(
    Object.values(getTableColumns(table)).map((column) => column.name),
  );
  for (const [, column] of columns) {
    if (!knownColumnNames.has(column)) {
      throw new Error(`Unknown ${tableName} bulk-insert column ${column}`);
    }
  }
  const columnSql = columns.map(([, column]) => `"${column}"`).join(", ");
  const valueSql = columns
    .map(([property]) => `json_extract(value, '$.${property}')`)
    .join(", ");
  return database
    .prepare(
      `INSERT INTO "${tableName}" (${columnSql}) SELECT ${valueSql} FROM json_each(?1)`,
    )
    .bind(JSON.stringify(rows));
}

function jsonInsertStatements<TRow>(
  database: D1Database,
  table: Table,
  columns: readonly ColumnMapping<TRow>[],
  rows: TRow[],
) {
  return chunks(rows, 100).map((batch) =>
    jsonInsertStatement(database, table, columns, batch),
  );
}

function importStatement(
  database: D1Database,
  review: CatalogWorkbookImportReview,
  status: "pending" | "failed",
) {
  return database
    .prepare(
      `INSERT INTO catalog_imports (
        id, kind, status, source_file_name, source_file_size_bytes,
        summary_json, error_count, warning_count, created_at, completed_at
      ) VALUES (?1, 'workbook', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      review.id,
      status,
      review.sourceFileName,
      review.sourceFileSizeBytes,
      JSON.stringify(review.summary),
      review.errorCount,
      review.warningCount,
      review.createdAt,
      status === "failed" ? review.completedAt : null,
    );
}

function auditStatement(
  database: D1Database,
  operation:
    SaveFailedCatalogImportOperation | SaveValidatedCatalogDraftOperation,
  eventType: string,
) {
  return database
    .prepare(
      `INSERT INTO admin_audit_events (
        id, event_type, entity_type, entity_id, actor_id, payload_json, occurred_at
      ) VALUES (?1, ?2, 'catalog_import', ?3, ?4, ?5, ?6)`,
    )
    .bind(
      operation.auditEventId,
      eventType,
      operation.review.id,
      operation.actorId,
      JSON.stringify({
        draftReleaseNumber: operation.review.draftReleaseNumber,
        errorCount: operation.review.errorCount,
        sourceFileName: operation.review.sourceFileName,
        summary: operation.review.summary,
      }),
      operation.review.completedAt,
    );
}

function validationRows(review: CatalogWorkbookImportReview) {
  return review.validationResults.map((result, index) => ({
    code: result.code,
    fieldName: result.field,
    id: `${review.id}:validation:${index + 1}`,
    importId: review.id,
    message: result.message,
    rowNumber: result.row,
    severity: result.severity,
    stableSku: result.sku,
    worksheet: result.worksheet,
  }));
}

interface ImportReviewRow {
  completed_at: string;
  created_at: string;
  draft_release_id: string | null;
  draft_release_number: string | null;
  error_count: number;
  id: string;
  source_file_name: string;
  source_file_size_bytes: number;
  status: "completed" | "failed";
  summary_json: string;
  warning_count: number;
}

interface ValidationResultRow {
  code: string;
  field_name: string;
  message: string;
  row_number: number;
  severity: "error" | "warning";
  stable_sku: string | null;
  worksheet: string;
}

async function readReview(database: D1Database, id: string) {
  const row = await database
    .prepare(
      `SELECT
        catalog_imports.id,
        catalog_imports.status,
        catalog_imports.source_file_name,
        catalog_imports.source_file_size_bytes,
        catalog_imports.summary_json,
        catalog_imports.error_count,
        catalog_imports.warning_count,
        catalog_imports.created_at,
        catalog_imports.completed_at,
        catalog_releases.id AS draft_release_id,
        catalog_releases.release_number AS draft_release_number
      FROM catalog_imports
      LEFT JOIN catalog_releases
        ON catalog_releases.source_import_id = catalog_imports.id
        AND catalog_releases.status = 'draft'
      WHERE catalog_imports.id = ?1 AND catalog_imports.kind = 'workbook'`,
    )
    .bind(id)
    .first<ImportReviewRow>();
  if (!row || (row.status !== "completed" && row.status !== "failed"))
    return null;

  const validation = await database
    .prepare(
      `SELECT worksheet, row_number, field_name, stable_sku, severity, code, message
       FROM catalog_import_validation_results
       WHERE import_id = ?1
       ORDER BY worksheet, row_number, field_name`,
    )
    .bind(id)
    .all<ValidationResultRow>();

  return {
    completedAt: row.completed_at,
    createdAt: row.created_at,
    draftReleaseId: row.draft_release_id,
    draftReleaseNumber: row.draft_release_number,
    errorCount: row.error_count,
    id: row.id,
    sourceFileName: row.source_file_name,
    sourceFileSizeBytes: row.source_file_size_bytes,
    status: row.status,
    summary: parseCatalogImportSummary(row.summary_json),
    validationResults: validation.results.map((result) => ({
      code: result.code,
      field: result.field_name,
      message: result.message,
      row: result.row_number,
      severity: result.severity,
      sku: result.stable_sku,
      worksheet: result.worksheet,
    })),
    warningCount: row.warning_count,
  } satisfies CatalogWorkbookImportReview;
}

export function createD1CatalogWorkbookImportRepository(
  database: D1Database,
): CatalogWorkbookImportRepository {
  return {
    async findImportReviewById(id) {
      return readReview(database, id);
    },

    async findLatestImportReview() {
      const latest = await database
        .prepare(
          `SELECT id FROM catalog_imports
           WHERE kind = 'workbook' AND status IN ('completed', 'failed')
           ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .first<{ id: string }>();
      return latest ? readReview(database, latest.id) : null;
    },

    async saveFailedImport(operation) {
      await database.batch([
        importStatement(database, operation.review, "failed"),
        ...jsonInsertStatements(
          database,
          catalogImportValidationResults,
          validationColumns,
          validationRows(operation.review),
        ),
        auditStatement(database, operation, "catalog_import.validation_failed"),
      ]);
    },

    async saveValidatedDraft(operation) {
      const { draft, review } = operation;
      await database.batch([
        importStatement(database, review, "pending"),
        ...jsonInsertStatements(
          database,
          catalogSkus,
          skuColumns,
          draft.skus.map((row) => ({
            ...row,
            id: `${review.id}:sku:${row.sku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogHoseSeries,
          hoseSeriesColumns,
          draft.hoseSeries.map((seriesCode) => ({
            id: `${review.id}:series:${seriesCode}`,
            importId: review.id,
            seriesCode,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogHoseVariants,
          hoseVariantColumns,
          draft.hoseVariants.map((row) => ({
            ...row,
            id: `${review.id}:hose:${row.sku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogHoseEnds,
          hoseEndColumns,
          draft.hoseEnds.map((row) => ({
            ...row,
            id: `${review.id}:end:${row.sku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogFerrules,
          ferruleColumns,
          draft.ferrules.map((row) => ({
            ...row,
            id: `${review.id}:ferrule:${row.sku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogAdapterFamilies,
          adapterFamilyColumns,
          draft.adapterFamilies.map((row) => ({
            ...row,
            id: `${review.id}:adapter-family:${row.adapterFamilyId}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogAdapters,
          adapterColumns,
          draft.adapters.map((row) => ({
            ...row,
            id: `${review.id}:adapter:${row.sku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogQuickCouplers,
          quickCouplerColumns,
          draft.quickCouplers.map((row) => ({
            ...row,
            id: `${review.id}:quick-coupler:${row.sku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogSalesOffers,
          salesOfferColumns,
          draft.salesOffers.map((row) => ({
            ...row,
            id: `${review.id}:sales-offer:${row.salesSku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogCostBases,
          costBasisColumns,
          draft.costBases.map((row) => ({
            ...row,
            id: `${review.id}:cost-basis:${row.salesSku}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogCompatibilities,
          compatibilityColumns,
          draft.compatibilities.map((row) => ({
            ...row,
            id: `${review.id}:compatibility:${row.compatibilityId}`,
            importId: review.id,
          })),
        ),
        ...jsonInsertStatements(
          database,
          catalogImportValidationResults,
          validationColumns,
          validationRows(review),
        ),
        database
          .prepare(
            `UPDATE catalog_imports
             SET status = 'completed', completed_at = ?2
             WHERE id = ?1 AND status = 'pending'`,
          )
          .bind(review.id, review.completedAt),
        database
          .prepare(
            `INSERT INTO catalog_releases (
              id, release_number, status, source_import_id, version, created_at, published_at
            ) VALUES (?1, ?2, 'draft', ?3, 1, ?4, NULL)`,
          )
          .bind(
            review.draftReleaseId,
            review.draftReleaseNumber,
            review.id,
            review.completedAt,
          ),
        auditStatement(database, operation, "catalog_import.draft_created"),
      ]);
    },
  };
}
