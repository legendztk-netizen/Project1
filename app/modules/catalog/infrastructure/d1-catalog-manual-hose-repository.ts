import type {
  CatalogManualHoseRepository,
  ManualHoseRecord,
  SaveManualHoseOperation,
} from "../domain/catalog-manual-hose";
import type {
  CatalogHoseMaintenanceRepository,
  HoseSeriesRecord,
  HoseVariantRecord,
  SaveHoseSeriesOperation,
  SaveHoseVariantOperation,
} from "../domain/catalog-hose-maintenance";
import type {
  CatalogHoseEndMaintenanceRepository,
  HoseEndSeriesRecord,
  HoseEndVariantRecord,
  SaveHoseEndSeriesOperation,
  SaveHoseEndVariantOperation,
} from "../domain/catalog-hose-end-maintenance";
import {
  reviewedAdapterImageReferences,
  reviewedFerruleImageReferences,
  reviewedHoseEndImageKeys,
  reviewedQuickCouplerImageReferences,
} from "../domain/catalog-main-image";
import { mediaVersionIdFromReference } from "../domain/catalog-product-image";
import { inferProductLifecycleStatus } from "../domain/catalog-product-lifecycle";
import type {
  CatalogManualComponentRepository,
  ManualComponentRecord,
  SaveManualComponentOperation,
} from "../domain/catalog-manual-component";
import type {
  AdapterDraft,
  CatalogPublicationStatus,
  CatalogSkuDraft,
  FerruleDraft,
  HoseEndDraft,
  QuickCouplerDraft,
  RfqEligibility,
  SalesOfferDraft,
  TechnicalDataStatus,
} from "../domain/catalog-workbook";

export interface CatalogDraftOperationIdentity {
  actorId: string;
  auditEventId: string;
  draftImportId: string;
  draftReleaseId: string;
  draftReleaseNumber: string;
  occurredAt: string;
}

export interface CatalogMaintenanceReleaseRow {
  id: string;
  release_number: string;
  source_import_id: string;
  status: "draft" | "published";
}

type ReleaseRow = CatalogMaintenanceReleaseRow;

interface IdentityRow {
  catalog_publication_status?: CatalogPublicationStatus;
  import_id?: string;
  product_type: CatalogSkuDraft["productType"];
  sku: string;
}

interface HoseRow {
  bend_radius_mm: number;
  burst_bar: number;
  catalog_publication_status: CatalogPublicationStatus;
  carton_gross_weight_kg: number | null;
  carton_h_cm: number | null;
  carton_l_cm: number | null;
  carton_w_cm: number | null;
  continuous_length_confirmation: string | null;
  country_of_origin: string;
  cover_color: string;
  cover_finish: string | null;
  cover_material: string;
  currency: "USD" | null;
  dash: string;
  equivalent_standard: string | null;
  fluid_compatibility: string;
  hose_series: string;
  hs_code: string | null;
  id_mm: number;
  inner_pack_qty: number | null;
  lead_time_days: number;
  main_image_reference: string;
  length_increment_ft: number | null;
  master_carton_qty: number | null;
  minimum_length_per_piece_ft: number | null;
  moq: number;
  msha_marking: string | null;
  net_unit_weight_kg: number | null;
  nominal_id_in: number;
  notes: string | null;
  od_mm: number;
  origin: string;
  package_length_ft: number | null;
  packing_basis: string | null;
  preset_length_1_ft: number | null;
  preset_length_2_ft: number | null;
  preset_length_3_ft: number | null;
  primary_standard: string;
  product_type: string;
  quantity_input_mode: string;
  reference_price_usd: number | null;
  reinforcement: string;
  rfq_eligibility: RfqEligibility;
  sales_notes: string | null;
  sales_sku: string;
  sales_unit: string;
  skive_requirement: string;
  sku: string;
  source: string;
  technical_data_status: TechnicalDataStatus;
  temp_max_c: number;
  temp_min_c: number;
  tube_material: string;
  units_per_sales_pack: number;
  weight_kg_m: number;
  working_bar: number;
  working_psi: number | null;
  supply_availability:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
}

interface HoseSeriesRow {
  cover_color: string | null;
  cover_finish: string | null;
  cover_material: string | null;
  equivalent_standard: string;
  fluid_compatibility: string | null;
  primary_standard: string;
  reinforcement: string | null;
  representative_image_reference: string;
  series_code: string;
  series_name: string;
  temp_max_c: number;
  temp_min_c: number;
  tube_material: string | null;
}

interface HoseVariantMaintenanceRow {
  bend_radius_mm: number;
  burst_bar: number;
  catalog_publication_status: CatalogPublicationStatus;
  dash: string;
  hose_series: string;
  id_mm: number;
  image_override_reference: string | null;
  msha_marking: string | null;
  nominal_id_in: number;
  notes: string;
  od_mm: number;
  skive_requirement: string | null;
  sku: string;
  source: string | null;
  supply_availability:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
  technical_data_status: TechnicalDataStatus;
  weight_kg_m: number;
  working_bar: number;
  working_psi: number;
}

interface HoseEndSeriesMaintenanceRow {
  angle: string;
  gender: string;
  interface_family: string;
  interface_standard: string;
  representative_image_reference: string;
  sealing_form: string;
  series_code: string;
  series_name: string;
  swivel_form: string;
}

interface HoseEndVariantMaintenanceRow {
  catalog_publication_status: CatalogPublicationStatus;
  coating: string;
  competitor_part_number: string | null;
  connection_dash: string;
  cutoff_b_mm: number;
  dimension_a_mm: number;
  drawing_number: string | null;
  drawing_revision: string | null;
  fitting_series: string;
  hex_1_mm: number;
  hex_2_mm: number;
  hose_tail_dash: string;
  image_override_reference: string | null;
  material: string;
  max_working_bar: number;
  minimum_bore_mm: number;
  notes: string;
  salt_spray_hours: number;
  sku: string;
  source: string | null;
  supply_availability:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
  technical_data_status: TechnicalDataStatus;
  thread: string;
  unit_weight_g: number;
}

interface ComponentSalesRow {
  catalog_publication_status: CatalogPublicationStatus;
  carton_gross_weight_kg: number | null;
  carton_h_cm: number | null;
  carton_l_cm: number | null;
  carton_w_cm: number | null;
  continuous_length_confirmation: string | null;
  country_of_origin: string;
  currency: "USD" | null;
  hs_code: string | null;
  inner_pack_qty: number | null;
  lead_time_days: number;
  length_increment_ft: number | null;
  main_image_reference: string;
  master_carton_qty: number | null;
  minimum_length_per_piece_ft: number | null;
  moq: number;
  net_unit_weight_kg: number | null;
  package_length_ft: number | null;
  packing_basis: string | null;
  preset_length_1_ft: number | null;
  preset_length_2_ft: number | null;
  preset_length_3_ft: number | null;
  product_type: string;
  quantity_input_mode: string;
  reference_price_usd: number | null;
  rfq_eligibility: RfqEligibility;
  sales_notes: string | null;
  sales_sku: string | null;
  sales_unit: string;
  sku: string;
  technical_data_status: TechnicalDataStatus;
  units_per_sales_pack: number;
  supply_availability:
    "available_for_quote" | "discontinued" | "temporarily_unavailable";
}

interface HoseEndRow extends ComponentSalesRow {
  angle: string;
  coating: string | null;
  competitor_part_number: string | null;
  connection_dash: string;
  connection_standard: string;
  cutoff_b_mm: number | null;
  dimension_a_mm: number | null;
  drawing_number: string | null;
  drawing_revision: string | null;
  fitting_series: string;
  gender: string;
  hex_1_mm: number | null;
  hex_2_mm: number | null;
  hose_tail_dash: string;
  interface_family: string;
  material: string | null;
  max_working_bar: number | null;
  minimum_bore_mm: number | null;
  notes: string | null;
  salt_spray_hours: number | null;
  sealing_form: string;
  source: string;
  swivel_form: string;
  thread: string;
  unit_weight_g: number | null;
}

interface FerruleRow extends ComponentSalesRow {
  coating: string;
  ferrule_series: string;
  hose_construction: string;
  hose_tail_dash: string;
  material: string;
  notes: string | null;
  skive_requirement: string;
  source: string;
}

interface AdapterRow extends ComponentSalesRow {
  adapter_family_id: string;
  catalog_model: string;
  connection_form_1: string;
  connection_form_2: string;
  connection_form_3: string | null;
  interface_1: string;
  interface_2: string;
  interface_3: string | null;
  notes: string | null;
  shape_code: string;
  size_1: string | null;
  size_2: string | null;
  size_3: string | null;
  sku_template: string;
  source: string;
  website_display: string;
  website_product_name: string;
}

interface QuickCouplerRow extends ComponentSalesRow {
  body_dash: string;
  body_material: string | null;
  body_size: string;
  coating: string | null;
  connection_mechanism: string;
  coupler_series: string;
  drawing_number: string | null;
  interchange_standard: string;
  mating_series: string;
  max_working_bar: number | null;
  minimum_burst_bar: number | null;
  notes: string | null;
  overall_length_mm: number | null;
  port_code: string;
  port_dash: string;
  port_gender: string;
  port_interface: string;
  port_thread: string;
  pressure_drop_basis: string | null;
  rated_flow_l_min: number | null;
  role: string;
  seal_material: string | null;
  sku_role_code: string;
  sku_standard_code: string;
  source: string;
  temp_max_c: number | null;
  temp_min_c: number | null;
  unit_weight_g: number | null;
  valving: string;
}

const clonedCatalogTables = [
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "source_worksheet",
      "product_type",
      "hose_series",
      "catalog_publication_status",
      "rfq_eligibility",
      "technical_data_status",
      "supply_availability",
    ],
    name: "catalog_skus",
  },
  {
    columns: [
      "id",
      "import_id",
      "series_code",
      "series_name",
      "primary_standard",
      "equivalent_standard",
      "temp_min_c",
      "temp_max_c",
      "tube_material",
      "reinforcement",
      "cover_material",
      "cover_color",
      "cover_finish",
      "fluid_compatibility",
      "representative_media_version_id",
    ],
    name: "catalog_hose_series",
  },
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "hose_series",
      "primary_standard",
      "equivalent_standard",
      "dash",
      "nominal_id_in",
      "id_mm",
      "od_mm",
      "working_bar",
      "working_psi",
      "burst_bar",
      "bend_radius_mm",
      "weight_kg_m",
      "temp_min_c",
      "temp_max_c",
      "tube_material",
      "reinforcement",
      "cover_material",
      "cover_color",
      "cover_finish",
      "skive_requirement",
      "msha_marking",
      "fluid_compatibility",
      "origin",
      "source",
      "notes",
    ],
    name: "catalog_hose_variants",
  },
  {
    columns: [
      "id",
      "import_id",
      "series_code",
      "series_name",
      "interface_family",
      "connection_standard",
      "gender",
      "swivel_form",
      "angle",
      "sealing_form",
      "representative_media_version_id",
    ],
    name: "catalog_hose_end_series",
  },
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "fitting_series",
      "competitor_part_number",
      "interface_family",
      "connection_standard",
      "gender",
      "swivel_form",
      "angle",
      "sealing_form",
      "thread",
      "connection_dash",
      "hose_tail_dash",
      "material",
      "coating",
      "salt_spray_hours",
      "max_working_bar",
      "dimension_a_mm",
      "cutoff_b_mm",
      "hex_1_mm",
      "hex_2_mm",
      "minimum_bore_mm",
      "unit_weight_g",
      "drawing_number",
      "drawing_revision",
      "source",
      "notes",
    ],
    name: "catalog_hose_ends",
  },
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "ferrule_series",
      "hose_construction",
      "hose_tail_dash",
      "skive_requirement",
      "material",
      "coating",
      "source",
      "notes",
    ],
    name: "catalog_ferrules",
  },
  {
    columns: [
      "id",
      "import_id",
      "adapter_family_id",
      "sku_template",
      "catalog_model",
      "website_product_name",
      "shape_code",
      "interface_1",
      "connection_form_1",
      "size_1",
      "interface_2",
      "connection_form_2",
      "size_2",
      "interface_3",
      "connection_form_3",
      "size_3",
      "website_display",
      "source",
      "notes",
      "catalog_publication_status",
      "rfq_eligibility",
      "technical_data_status",
    ],
    name: "catalog_adapter_families",
  },
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "adapter_family_id",
      "sku_template",
      "catalog_model",
      "website_product_name",
      "shape_code",
      "interface_1",
      "connection_form_1",
      "size_1",
      "interface_2",
      "connection_form_2",
      "size_2",
      "interface_3",
      "connection_form_3",
      "size_3",
      "website_display",
      "source",
      "notes",
    ],
    name: "catalog_adapters",
  },
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "sku_standard_code",
      "sku_role_code",
      "body_dash",
      "port_code",
      "port_dash",
      "coupler_series",
      "role",
      "mating_series",
      "interchange_standard",
      "body_size",
      "port_interface",
      "port_gender",
      "port_thread",
      "connection_mechanism",
      "valving",
      "body_material",
      "coating",
      "seal_material",
      "max_working_bar",
      "minimum_burst_bar",
      "rated_flow_l_min",
      "pressure_drop_basis",
      "temp_min_c",
      "temp_max_c",
      "overall_length_mm",
      "unit_weight_g",
      "drawing_number",
      "source",
      "notes",
    ],
    name: "catalog_quick_couplers",
  },
  {
    columns: [
      "id",
      "import_id",
      "base_sku",
      "sales_sku",
      "product_type",
      "sales_unit",
      "package_length_ft",
      "units_per_sales_pack",
      "moq",
      "net_unit_weight_kg",
      "lead_time_days",
      "country_of_origin",
      "currency",
      "reference_price_usd",
      "inner_pack_qty",
      "master_carton_qty",
      "carton_gross_weight_kg",
      "carton_l_cm",
      "carton_w_cm",
      "carton_h_cm",
      "packing_basis",
      "hs_code",
      "notes",
      "catalog_publication_status",
      "rfq_eligibility",
      "technical_data_status",
      "quantity_input_mode",
      "minimum_length_per_piece_ft",
      "length_increment_ft",
      "preset_length_1_ft",
      "preset_length_2_ft",
      "preset_length_3_ft",
      "continuous_length_confirmation",
    ],
    name: "catalog_sales_offers",
  },
  {
    columns: [
      "id",
      "import_id",
      "product_type",
      "series_code",
      "sales_unit",
      "moq",
      "lead_time_days",
      "country_of_origin",
      "hs_code",
      "notes",
      "quantity_input_mode",
      "minimum_length_per_piece_ft",
      "length_increment_ft",
      "preset_length_1_ft",
      "preset_length_2_ft",
      "preset_length_3_ft",
      "continuous_length_confirmation",
    ],
    name: "catalog_series_commercial_rules",
  },
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "sales_sku",
      "reference_price_usd",
      "currency",
      "package_length_ft",
      "units_per_sales_pack",
      "net_unit_weight_kg",
      "inner_pack_qty",
      "master_carton_qty",
      "carton_gross_weight_kg",
      "carton_l_cm",
      "carton_w_cm",
      "carton_h_cm",
      "packing_basis",
    ],
    name: "catalog_sku_price_packaging",
  },
  {
    columns: [
      "id",
      "import_id",
      "sales_sku",
      "currency",
      "factory_unit_price",
      "price_incoterm",
      "incoterm_place",
      "tier_qty",
      "tier_price",
    ],
    name: "catalog_cost_bases",
  },
  {
    columns: [
      "id",
      "import_id",
      "sku",
      "media_version_id",
      "assigned_at",
      "assigned_by",
      "assignment_kind",
    ],
    name: "catalog_product_main_images",
  },
  {
    columns: [
      "id",
      "import_id",
      "compatibility_id",
      "hose_sku",
      "hose_end_sku",
      "ferrule_sku",
      "catalog_publication_status",
      "assembly_method",
      "skive_requirement",
      "outer_skive_length_mm",
      "inner_skive_length_mm",
      "insertion_depth_mm",
      "crimp_program",
      "final_crimp_diameter_mm",
      "tolerance_mm",
      "measurement_location",
      "assembly_working_bar",
      "proof_pressure_bar",
      "proof_hold_seconds",
      "qualification_id",
      "qualification_status",
      "rfq_eligibility",
      "reference_system",
      "reference_hose_code",
      "reference_assembly_method",
      "reference_crimp_diameter_mm",
      "reference_tolerance_mm",
      "reference_source",
      "notes",
      "technical_data_status",
      "production_approval_status",
    ],
    name: "catalog_compatibilities",
  },
] as const;

function approvedMediaVersionId(reference: string) {
  return `approved-v1:${reference}`;
}

function resolvedMediaVersionId(reference: string) {
  return (
    mediaVersionIdFromReference(reference) ?? approvedMediaVersionId(reference)
  );
}

function approvedMediaStatements(
  database: D1Database,
  reference: string,
  actorId: string,
  occurredAt: string,
) {
  if (mediaVersionIdFromReference(reference)) return [];
  const lineageId = `approved:${reference}`;
  return [
    database
      .prepare(
        `INSERT OR IGNORE INTO catalog_media_lineages (
           id, logical_reference, created_at, created_by, source_notes, license_notes
         ) VALUES (?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(lineageId, reference, occurredAt, actorId),
    database
      .prepare(
        `INSERT OR IGNORE INTO catalog_media_versions (
           id, lineage_id, version, source_kind, approved_reference,
           master_object_key, storefront_object_key, thumbnail_object_key,
           content_hash, mime_type, width, height, created_at, created_by
         ) VALUES (?, ?, 1, 'approved_reference', ?, NULL, NULL, NULL,
                   NULL, 'reference', NULL, NULL, ?, ?)`,
      )
      .bind(
        approvedMediaVersionId(reference),
        lineageId,
        reference,
        occurredAt,
        actorId,
      ),
  ];
}

function mainImageMutationStatements(
  database: D1Database,
  operation: SaveManualHoseOperation | SaveManualComponentOperation,
  draft: ReleaseRow,
  sku: string,
  affectedSkus: string[],
) {
  const newVersionId = resolvedMediaVersionId(operation.mainImageReference);
  const statements = approvedMediaStatements(
    database,
    operation.mainImageReference,
    operation.actorId,
    operation.occurredAt,
  );
  if (operation.replaceSharedImageFrom) {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_product_main_images
           SET media_version_id = ?, assigned_at = ?, assigned_by = ?
           WHERE import_id = ? AND media_version_id = ?`,
        )
        .bind(
          newVersionId,
          operation.occurredAt,
          operation.actorId,
          draft.source_import_id,
          resolvedMediaVersionId(operation.replaceSharedImageFrom),
        ),
      database
        .prepare(
          `UPDATE catalog_hose_series
           SET representative_media_version_id = ?
           WHERE import_id = ? AND representative_media_version_id = ?`,
        )
        .bind(
          newVersionId,
          draft.source_import_id,
          resolvedMediaVersionId(operation.replaceSharedImageFrom),
        ),
      database
        .prepare(
          `UPDATE catalog_hose_end_series
           SET representative_media_version_id = ?
           WHERE import_id = ? AND representative_media_version_id = ?`,
        )
        .bind(
          newVersionId,
          draft.source_import_id,
          resolvedMediaVersionId(operation.replaceSharedImageFrom),
        ),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO catalog_product_main_images (
           id, import_id, sku, media_version_id, assigned_at, assigned_by,
           assignment_kind
         ) VALUES (?, ?, ?, ?, ?, ?, 'override')
         ON CONFLICT(import_id, sku) DO UPDATE SET
           media_version_id = excluded.media_version_id,
           assigned_at = excluded.assigned_at,
           assigned_by = excluded.assigned_by,
           assignment_kind = CASE
             WHEN catalog_product_main_images.media_version_id = excluded.media_version_id
               THEN catalog_product_main_images.assignment_kind
             ELSE 'override'
           END`,
      )
      .bind(
        operation.mediaAssignmentId,
        draft.source_import_id,
        sku,
        newVersionId,
        operation.occurredAt,
        operation.actorId,
      ),
  );
  if (operation.replaceSharedImageFrom) {
    statements.push(
      database
        .prepare(
          `INSERT INTO admin_audit_events (
             id, event_type, entity_type, entity_id,
             actor_id, payload_json, occurred_at
           ) VALUES (?, 'catalog_media.shared_image_replaced',
                     'catalog_media_version', ?, ?, ?, ?)`,
        )
        .bind(
          `${operation.auditEventId}:image`,
          newVersionId,
          operation.actorId,
          JSON.stringify({
            affectedSkus,
            draftReleaseId: draft.id,
            fromReference: operation.replaceSharedImageFrom,
            toReference: operation.mainImageReference,
          }),
          operation.occurredAt,
        ),
    );
  }
  return statements;
}

async function findImageAffectedSkus(
  database: D1Database,
  importId: string | null,
  reference: string | null,
) {
  if (!importId || !reference) return [];
  const rows = await database
    .prepare(
      `SELECT sku FROM catalog_product_main_images
       WHERE import_id = ? AND media_version_id = ? ORDER BY sku`,
    )
    .bind(importId, resolvedMediaVersionId(reference))
    .all<{ sku: string }>();
  return rows.results.map((row) => row.sku);
}

const emptySummary = JSON.stringify({
  adapterCount: 0,
  adapterFamilyCount: 0,
  compatibilityCount: 0,
  costBasisPriceCount: 0,
  ferruleCount: 0,
  hoseEndCount: 0,
  hoseSeriesCount: 0,
  hoseVariantCount: 0,
  quickCouplerCount: 0,
  referencePriceCount: 0,
  salesOfferCount: 0,
  skuCount: 0,
});

async function findCurrentDraft(database: D1Database) {
  return database
    .prepare(
      `SELECT draft.id, draft.release_number, draft.source_import_id, draft.status
       FROM catalog_releases draft
       WHERE draft.status = 'draft'
         AND (
           (SELECT release_id FROM catalog_active_release WHERE singleton = 1) IS NULL
           OR draft.created_at > COALESCE(
             (
               SELECT active_release.created_at
               FROM catalog_active_release active_pointer
               INNER JOIN catalog_releases active_release
                 ON active_release.id = active_pointer.release_id
               WHERE active_pointer.singleton = 1
             ),
             ''
           )
         )
       ORDER BY draft.created_at DESC, draft.id DESC
       LIMIT 1`,
    )
    .first<ReleaseRow>();
}

async function findActiveRelease(database: D1Database) {
  return database
    .prepare(
      `SELECT active.id, active.release_number, active.source_import_id,
              active.status
       FROM catalog_active_release pointer
       INNER JOIN catalog_releases active ON active.id = pointer.release_id
       WHERE pointer.singleton = 1 AND active.status = 'published'`,
    )
    .first<ReleaseRow>();
}

async function findMaintenanceRelease(database: D1Database) {
  return (await findCurrentDraft(database)) ?? findActiveRelease(database);
}

async function findProductIdentityInCatalog(database: D1Database, sku: string) {
  const maintenance = await findMaintenanceRelease(database);
  const active = await findActiveRelease(database);
  const importIds = [
    ...new Set(
      [maintenance?.source_import_id, active?.source_import_id].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
  if (importIds.length === 0) return null;
  const row = await database
    .prepare(
      `SELECT sku, product_type
       FROM catalog_skus
       WHERE import_id IN (SELECT value FROM json_each(?)) AND sku = ?
       LIMIT 1`,
    )
    .bind(JSON.stringify(importIds), sku.trim().toUpperCase())
    .first<IdentityRow>();
  return row ? { productType: row.product_type, sku: row.sku } : null;
}

function cloneStatement(
  database: D1Database,
  table: (typeof clonedCatalogTables)[number],
  draftImportId: string,
  sourceImportId: string,
) {
  const columns = table.columns.join(", ");
  const values = table.columns
    .map((column) =>
      column === "id"
        ? "?1 || ':' || id"
        : column === "import_id"
          ? "?1"
          : column,
    )
    .join(", ");
  return database
    .prepare(
      `INSERT INTO ${table.name} (${columns})
       SELECT ${values} FROM ${table.name} WHERE import_id = ?2`,
    )
    .bind(draftImportId, sourceImportId);
}

function draftCreationStatements(
  database: D1Database,
  operation: CatalogDraftOperationIdentity,
  active: ReleaseRow | null,
) {
  const sourceImportId = active?.source_import_id ?? null;
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO catalog_imports (
           id, kind, status, source_file_name, source_file_size_bytes,
           summary_json, error_count, warning_count, created_at, completed_at
         )
         SELECT ?1, 'workbook', 'completed', 'Manual Add/Edit', 0,
                COALESCE(source.summary_json, ?2), 0, 0, ?3, ?3
         FROM (SELECT 1) seed
         LEFT JOIN catalog_imports source ON source.id = ?4`,
      )
      .bind(
        operation.draftImportId,
        emptySummary,
        operation.occurredAt,
        sourceImportId,
      ),
  ];
  if (sourceImportId) {
    statements.push(
      ...clonedCatalogTables.map((table) =>
        cloneStatement(
          database,
          table,
          operation.draftImportId,
          sourceImportId,
        ),
      ),
      database
        .prepare(
          `UPDATE catalog_sales_offers AS offer
           SET catalog_publication_status = (
                 SELECT product.catalog_publication_status
                 FROM catalog_skus product
                 WHERE product.import_id = offer.import_id
                   AND product.sku = offer.base_sku
               ),
               rfq_eligibility = (
                 SELECT product.rfq_eligibility
                 FROM catalog_skus product
                 WHERE product.import_id = offer.import_id
                   AND product.sku = offer.base_sku
               ),
               technical_data_status = (
                 SELECT product.technical_data_status
                 FROM catalog_skus product
                 WHERE product.import_id = offer.import_id
                   AND product.sku = offer.base_sku
               )
           WHERE offer.import_id = ?`,
        )
        .bind(operation.draftImportId),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO catalog_releases (
           id, release_number, status, source_import_id,
           version, created_at, published_at
         ) VALUES (?1, ?2, 'draft', ?3, 1, ?4, NULL)`,
      )
      .bind(
        operation.draftReleaseId,
        operation.draftReleaseNumber,
        operation.draftImportId,
        operation.occurredAt,
      ),
  );
  if (active) {
    statements.push(
      database
        .prepare(
          `DELETE FROM catalog_configurator_registry_entries
           WHERE release_id = ?`,
        )
        .bind(operation.draftReleaseId),
      database
        .prepare(
          `INSERT INTO catalog_configurator_registry_entries (
             release_id, registry_type, entry_key, payload_json,
             record_version, updated_at
           )
           SELECT ?, registry_type, entry_key, payload_json,
                  record_version, updated_at
           FROM catalog_configurator_registry_entries
           WHERE release_id = ?`,
        )
        .bind(operation.draftReleaseId, active.id),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, 'catalog_manual.draft_created', 'catalog_release', ?, ?, ?, ?)`,
      )
      .bind(
        `${operation.auditEventId}:draft`,
        operation.draftReleaseId,
        operation.actorId,
        JSON.stringify({ clonedFromReleaseId: active?.id ?? null }),
        operation.occurredAt,
      ),
  );
  return statements;
}

export async function prepareCatalogDraftMutation(
  database: D1Database,
  operation: CatalogDraftOperationIdentity,
) {
  const current = await findCurrentDraft(database);
  if (current) return { creationStatements: [], draft: current };
  const active = await findActiveRelease(database);
  return {
    creationStatements: draftCreationStatements(database, operation, active),
    draft: {
      id: operation.draftReleaseId,
      release_number: operation.draftReleaseNumber,
      source_import_id: operation.draftImportId,
      status: "draft" as const,
    },
  };
}

function skuValues(operation: SaveManualHoseOperation) {
  const { hose } = operation;
  return [
    "01_胶管主数据",
    "hose",
    hose.hoseSeries,
    hose.catalogPublicationStatus,
    hose.rfqEligibility,
    hose.technicalDataStatus,
  ] as const;
}

function hoseValues(operation: SaveManualHoseOperation) {
  const row = operation.hose;
  return [
    row.hoseSeries,
    row.primaryStandard,
    row.equivalentStandard,
    row.dash,
    row.nominalIdIn,
    row.idMm,
    row.odMm,
    row.workingBar,
    row.workingPsi,
    row.burstBar,
    row.bendRadiusMm,
    row.weightKgM,
    row.tempMinC,
    row.tempMaxC,
    row.tubeMaterial,
    row.reinforcement,
    row.coverMaterial,
    row.coverColor,
    row.coverFinish,
    row.skiveRequirement,
    row.mshaMarking,
    row.fluidCompatibility,
    row.origin,
    row.source,
    row.notes,
  ] as const;
}

function salesValues(row: SalesOfferDraft) {
  return [
    row.salesSku,
    row.productType,
    row.salesUnit,
    row.packageLengthFt,
    row.unitsPerSalesPack,
    row.moq,
    row.netUnitWeightKg,
    row.leadTimeDays,
    row.countryOfOrigin,
    row.currency,
    row.referencePriceUsd,
    row.innerPackQty,
    row.masterCartonQty,
    row.cartonGrossWeightKg,
    row.cartonLCm,
    row.cartonWCm,
    row.cartonHCm,
    row.packingBasis,
    row.hsCode,
    row.notes,
    row.catalogPublicationStatus,
    row.rfqEligibility,
    row.technicalDataStatus,
    row.quantityInputMode,
    row.minimumLengthPerPieceFt,
    row.lengthIncrementFt,
    row.presetLength1Ft,
    row.presetLength2Ft,
    row.presetLength3Ft,
    row.continuousLengthConfirmation,
  ] as const;
}

function mutationStatements(
  database: D1Database,
  operation: SaveManualHoseOperation,
  draft: ReleaseRow,
  imageAffectedSkus: string[],
) {
  const { hose, salesOffer } = operation;
  const statements: D1PreparedStatement[] = [
    ...approvedMediaStatements(
      database,
      operation.mainImageReference,
      operation.actorId,
      operation.occurredAt,
    ),
    database
      .prepare(
        `INSERT OR IGNORE INTO catalog_hose_series (
           id, import_id, series_code, series_name, primary_standard,
           equivalent_standard, temp_min_c, temp_max_c, tube_material,
           reinforcement, cover_material, cover_color, cover_finish,
           fluid_compatibility, representative_media_version_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `${operation.hoseId}:series:${hose.hoseSeries}`,
        draft.source_import_id,
        hose.hoseSeries,
        hose.hoseSeries,
        hose.primaryStandard,
        hose.equivalentStandard || "N/A",
        hose.tempMinC,
        hose.tempMaxC,
        hose.tubeMaterial,
        hose.reinforcement,
        hose.coverMaterial,
        hose.coverColor,
        hose.coverFinish,
        hose.fluidCompatibility,
        resolvedMediaVersionId(operation.mainImageReference),
      ),
  ];
  if (operation.mode === "create") {
    statements.push(
      database
        .prepare(
          `INSERT INTO catalog_skus (
             id, import_id, sku, source_worksheet, product_type, hose_series,
             catalog_publication_status, rfq_eligibility,
             technical_data_status, supply_availability
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'temporarily_unavailable'))`,
        )
        .bind(
          operation.skuId,
          draft.source_import_id,
          hose.sku,
          ...skuValues(operation),
          operation.supplyAvailability ?? null,
        ),
      database
        .prepare(
          `INSERT INTO catalog_hose_variants (
             id, import_id, sku, hose_series, primary_standard,
             equivalent_standard, dash, nominal_id_in, id_mm, od_mm,
             working_bar, working_psi, burst_bar, bend_radius_mm, weight_kg_m,
             temp_min_c, temp_max_c, tube_material, reinforcement,
             cover_material, cover_color, cover_finish, skive_requirement,
             msha_marking, fluid_compatibility, origin, source, notes
           ) VALUES (?, ?, ?, ${Array.from({ length: 25 }, (_, index) => `?${index + 4}`).join(", ")})`,
        )
        .bind(
          operation.hoseId,
          draft.source_import_id,
          hose.sku,
          ...hoseValues(operation),
        ),
      database
        .prepare(
          `INSERT INTO catalog_sales_offers (
             id, import_id, base_sku, sales_sku, product_type, sales_unit,
             package_length_ft, units_per_sales_pack, moq, net_unit_weight_kg,
             lead_time_days, country_of_origin, currency, reference_price_usd,
             inner_pack_qty, master_carton_qty, carton_gross_weight_kg,
             carton_l_cm, carton_w_cm, carton_h_cm, packing_basis, hs_code,
             notes, catalog_publication_status, rfq_eligibility,
             technical_data_status, quantity_input_mode,
             minimum_length_per_piece_ft, length_increment_ft,
             preset_length_1_ft, preset_length_2_ft, preset_length_3_ft,
             continuous_length_confirmation
           ) VALUES (?, ?, ?, ${Array.from({ length: 30 }, (_, index) => `?${index + 4}`).join(", ")})`,
        )
        .bind(
          operation.salesOfferId,
          draft.source_import_id,
          hose.sku,
          ...salesValues(operation.salesOffer),
        ),
      database
        .prepare(
          `INSERT INTO catalog_cost_bases (
             id, import_id, sales_sku, currency, factory_unit_price,
             price_incoterm, incoterm_place, tier_qty, tier_price
           ) VALUES (?, ?, ?, 'USD', NULL, NULL, NULL, NULL, NULL)`,
        )
        .bind(
          operation.costBasisId,
          draft.source_import_id,
          salesOffer.salesSku,
        ),
    );
  } else {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_skus
           SET source_worksheet = ?, product_type = ?, hose_series = ?,
               catalog_publication_status = ?, rfq_eligibility = ?,
               technical_data_status = ?,
               supply_availability = COALESCE(?, supply_availability)
           WHERE import_id = ? AND sku = ? AND product_type = 'hose'`,
        )
        .bind(
          ...skuValues(operation),
          operation.supplyAvailability ?? null,
          draft.source_import_id,
          hose.sku,
        ),
      database
        .prepare(
          `UPDATE catalog_hose_variants
           SET hose_series = ?, primary_standard = ?, equivalent_standard = ?,
               dash = ?, nominal_id_in = ?, id_mm = ?, od_mm = ?,
               working_bar = ?, working_psi = ?, burst_bar = ?,
               bend_radius_mm = ?, weight_kg_m = ?, temp_min_c = ?,
               temp_max_c = ?, tube_material = ?, reinforcement = ?,
               cover_material = ?, cover_color = ?, cover_finish = ?,
               skive_requirement = ?, msha_marking = ?, fluid_compatibility = ?,
               origin = ?, source = ?, notes = ?
           WHERE import_id = ? AND sku = ?`,
        )
        .bind(...hoseValues(operation), draft.source_import_id, hose.sku),
      database
        .prepare(
          `UPDATE catalog_sales_offers
           SET sales_sku = ?, product_type = ?, sales_unit = ?,
               package_length_ft = ?, units_per_sales_pack = ?, moq = ?,
               net_unit_weight_kg = ?, lead_time_days = ?, country_of_origin = ?,
               currency = ?, reference_price_usd = ?, inner_pack_qty = ?,
               master_carton_qty = ?, carton_gross_weight_kg = ?, carton_l_cm = ?,
               carton_w_cm = ?, carton_h_cm = ?, packing_basis = ?, hs_code = ?,
               notes = ?, catalog_publication_status = ?, rfq_eligibility = ?,
               technical_data_status = ?, quantity_input_mode = ?,
               minimum_length_per_piece_ft = ?, length_increment_ft = ?,
               preset_length_1_ft = ?, preset_length_2_ft = ?, preset_length_3_ft = ?,
               continuous_length_confirmation = ?
           WHERE import_id = ? AND base_sku = ?`,
        )
        .bind(
          ...salesValues(operation.salesOffer),
          draft.source_import_id,
          hose.sku,
        ),
    );
  }
  statements.push(
    ...mainImageMutationStatements(
      database,
      operation,
      draft,
      hose.sku,
      imageAffectedSkus,
    ),
    database
      .prepare(
        `UPDATE catalog_hose_series
         SET representative_media_version_id = COALESCE(
           representative_media_version_id, ?
         )
         WHERE import_id = ? AND series_code = ?`,
      )
      .bind(
        resolvedMediaVersionId(operation.mainImageReference),
        draft.source_import_id,
        hose.hoseSeries,
      ),
    database
      .prepare(
        `UPDATE catalog_imports
         SET summary_json = json_set(
           summary_json,
           '$.skuCount', (SELECT COUNT(*) FROM catalog_skus WHERE import_id = ?1),
           '$.hoseSeriesCount', (SELECT COUNT(*) FROM catalog_hose_series WHERE import_id = ?1),
           '$.hoseVariantCount', (SELECT COUNT(*) FROM catalog_hose_variants WHERE import_id = ?1),
           '$.hoseEndCount', (SELECT COUNT(*) FROM catalog_hose_ends WHERE import_id = ?1),
           '$.ferruleCount', (SELECT COUNT(*) FROM catalog_ferrules WHERE import_id = ?1),
           '$.compatibilityCount', (SELECT COUNT(*) FROM catalog_compatibilities WHERE import_id = ?1),
           '$.adapterFamilyCount', (SELECT COUNT(*) FROM catalog_adapter_families WHERE import_id = ?1),
           '$.adapterCount', (SELECT COUNT(*) FROM catalog_adapters WHERE import_id = ?1),
           '$.quickCouplerCount', (SELECT COUNT(*) FROM catalog_quick_couplers WHERE import_id = ?1),
           '$.salesOfferCount', (SELECT COUNT(*) FROM catalog_sales_offers WHERE import_id = ?1),
           '$.referencePriceCount', (SELECT COUNT(*) FROM catalog_sales_offers WHERE import_id = ?1 AND reference_price_usd IS NOT NULL),
           '$.costBasisPriceCount', (SELECT COUNT(*) FROM catalog_cost_bases WHERE import_id = ?1 AND (factory_unit_price IS NOT NULL OR tier_price IS NOT NULL))
         )
         WHERE id = ?1`,
      )
      .bind(draft.source_import_id),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, ?, 'catalog_sku', ?, ?, ?, ?)`,
      )
      .bind(
        operation.auditEventId,
        operation.mode === "create"
          ? "catalog_manual.hose_created"
          : "catalog_manual.hose_updated",
        hose.sku,
        operation.actorId,
        JSON.stringify({
          draftReleaseId: draft.id,
          hoseSeries: hose.hoseSeries,
          mainImageReference: operation.mainImageReference,
          referencePriceUsd: salesOffer?.referencePriceUsd ?? null,
          salesSku: salesOffer?.salesSku ?? null,
        }),
        operation.occurredAt,
      ),
  );
  return statements;
}

function componentSalesOffer(row: ComponentSalesRow): SalesOfferDraft {
  return {
    baseSku: row.sku,
    catalogPublicationStatus: row.catalog_publication_status,
    cartonGrossWeightKg: row.carton_gross_weight_kg,
    cartonHCm: row.carton_h_cm,
    cartonLCm: row.carton_l_cm,
    cartonWCm: row.carton_w_cm,
    continuousLengthConfirmation: row.continuous_length_confirmation,
    countryOfOrigin: row.country_of_origin,
    currency: row.currency,
    hsCode: row.hs_code,
    innerPackQty: row.inner_pack_qty,
    leadTimeDays: row.lead_time_days,
    lengthIncrementFt: row.length_increment_ft,
    masterCartonQty: row.master_carton_qty,
    minimumLengthPerPieceFt: row.minimum_length_per_piece_ft,
    moq: row.moq,
    netUnitWeightKg: row.net_unit_weight_kg,
    notes: row.sales_notes,
    packageLengthFt: row.package_length_ft,
    packingBasis: row.packing_basis,
    presetLength1Ft: row.preset_length_1_ft,
    presetLength2Ft: row.preset_length_2_ft,
    presetLength3Ft: row.preset_length_3_ft,
    productType: row.product_type,
    quantityInputMode: row.quantity_input_mode,
    referencePriceUsd: row.reference_price_usd,
    rfqEligibility: row.rfq_eligibility,
    salesSku: row.sales_sku ?? "",
    salesUnit: row.sales_unit,
    technicalDataStatus: row.technical_data_status,
    unitsPerSalesPack: row.units_per_sales_pack,
  };
}

function hoseEndMaster(row: HoseEndRow): HoseEndDraft {
  return {
    angle: row.angle,
    catalogPublicationStatus: row.catalog_publication_status,
    coating: row.coating,
    competitorPartNumber: row.competitor_part_number,
    connectionDash: row.connection_dash,
    connectionStandard: row.connection_standard,
    cutoffBMm: row.cutoff_b_mm,
    dimensionAMm: row.dimension_a_mm,
    drawingNumber: row.drawing_number,
    drawingRevision: row.drawing_revision,
    fittingSeries: row.fitting_series,
    gender: row.gender,
    hex1Mm: row.hex_1_mm,
    hex2Mm: row.hex_2_mm,
    hoseTailDash: row.hose_tail_dash,
    interfaceFamily: row.interface_family,
    material: row.material,
    maxWorkingBar: row.max_working_bar,
    minimumBoreMm: row.minimum_bore_mm,
    notes: row.notes,
    rfqEligibility: row.rfq_eligibility,
    saltSprayHours: row.salt_spray_hours,
    sealingForm: row.sealing_form,
    sku: row.sku,
    source: row.source,
    swivelForm: row.swivel_form,
    technicalDataStatus: row.technical_data_status,
    thread: row.thread,
    unitWeightG: row.unit_weight_g,
  };
}

function ferruleMaster(row: FerruleRow): FerruleDraft {
  return {
    catalogPublicationStatus: row.catalog_publication_status,
    coating: row.coating,
    ferruleSeries: row.ferrule_series,
    hoseConstruction: row.hose_construction,
    hoseTailDash: row.hose_tail_dash,
    material: row.material,
    notes: row.notes,
    rfqEligibility: row.rfq_eligibility,
    skiveRequirement: row.skive_requirement,
    sku: row.sku,
    source: row.source,
    technicalDataStatus: row.technical_data_status,
  };
}

function adapterMaster(row: AdapterRow): AdapterDraft {
  return {
    adapterFamilyId: row.adapter_family_id,
    catalogModel: row.catalog_model,
    catalogPublicationStatus: row.catalog_publication_status,
    connectionForm1: row.connection_form_1,
    connectionForm2: row.connection_form_2,
    connectionForm3: row.connection_form_3,
    interface1: row.interface_1,
    interface2: row.interface_2,
    interface3: row.interface_3,
    notes: row.notes,
    rfqEligibility: row.rfq_eligibility,
    shapeCode: row.shape_code,
    size1: row.size_1,
    size2: row.size_2,
    size3: row.size_3,
    sku: row.sku,
    skuTemplate: row.sku_template,
    source: row.source,
    technicalDataStatus: row.technical_data_status,
    websiteDisplay: row.website_display,
    websiteProductName: row.website_product_name,
  };
}

function quickCouplerMaster(row: QuickCouplerRow): QuickCouplerDraft {
  return {
    bodyDash: row.body_dash,
    bodyMaterial: row.body_material,
    bodySize: row.body_size,
    catalogPublicationStatus: row.catalog_publication_status,
    coating: row.coating,
    connectionMechanism: row.connection_mechanism,
    couplerSeries: row.coupler_series,
    drawingNumber: row.drawing_number,
    interchangeStandard: row.interchange_standard,
    matingSeries: row.mating_series,
    maxWorkingBar: row.max_working_bar,
    minimumBurstBar: row.minimum_burst_bar,
    notes: row.notes,
    overallLengthMm: row.overall_length_mm,
    portCode: row.port_code,
    portDash: row.port_dash,
    portGender: row.port_gender,
    portInterface: row.port_interface,
    portThread: row.port_thread,
    pressureDropBasis: row.pressure_drop_basis,
    ratedFlowLMin: row.rated_flow_l_min,
    rfqEligibility: row.rfq_eligibility,
    role: row.role,
    sealMaterial: row.seal_material,
    sku: row.sku,
    skuRoleCode: row.sku_role_code,
    skuStandardCode: row.sku_standard_code,
    source: row.source,
    technicalDataStatus: row.technical_data_status,
    tempMaxC: row.temp_max_c,
    tempMinC: row.temp_min_c,
    unitWeightG: row.unit_weight_g,
    valving: row.valving,
  };
}

function defaultHoseEndImageReference(row: HoseEndRow) {
  const interfaceName = row.fitting_series.startsWith("FPX")
    ? "NPSM"
    : row.fitting_series.startsWith("C61")
      ? "SAE Code 61"
      : row.interface_family;
  const mediaKey = [
    interfaceName,
    row.gender === "N/A" ? null : row.gender,
    row.swivel_form,
    row.angle,
  ]
    .filter(Boolean)
    .join("-");
  const exact = reviewedHoseEndImageKeys.find((key) => key === mediaKey);
  return exact ? `hose-end-shape:${exact}` : "";
}

function toManualComponentRecord(
  row: AdapterRow | FerruleRow | HoseEndRow | QuickCouplerRow,
  release: ReleaseRow,
  productType: "adapter" | "ferrule" | "hose_end" | "quick_coupler",
): ManualComponentRecord {
  const fallbackImage =
    productType === "hose_end"
      ? defaultHoseEndImageReference(row as HoseEndRow)
      : productType === "ferrule"
        ? reviewedFerruleImageReferences[0].reference
        : productType === "adapter"
          ? reviewedAdapterImageReferences[0].reference
          : reviewedQuickCouplerImageReferences[0].reference;
  const master = {
    adapter: () => adapterMaster(row as AdapterRow),
    ferrule: () => ferruleMaster(row as FerruleRow),
    hose_end: () => hoseEndMaster(row as HoseEndRow),
    quick_coupler: () => quickCouplerMaster(row as QuickCouplerRow),
  }[productType]();
  return {
    mainImageReference: row.main_image_reference || fallbackImage,
    master,
    productType,
    release: {
      id: release.id,
      releaseNumber: release.release_number,
      status: release.status,
    },
    salesOffer: row.sales_sku ? componentSalesOffer(row) : null,
    supplyAvailability: row.supply_availability,
  };
}

function hoseEndValues(master: HoseEndDraft) {
  return [
    master.fittingSeries,
    master.competitorPartNumber,
    master.interfaceFamily,
    master.connectionStandard,
    master.gender,
    master.swivelForm,
    master.angle,
    master.sealingForm,
    master.thread,
    master.connectionDash,
    master.hoseTailDash,
    master.material,
    master.coating,
    master.saltSprayHours,
    master.maxWorkingBar,
    master.dimensionAMm,
    master.cutoffBMm,
    master.hex1Mm,
    master.hex2Mm,
    master.minimumBoreMm,
    master.unitWeightG,
    master.drawingNumber,
    master.drawingRevision,
    master.source,
    master.notes,
  ] as const;
}

function ferruleValues(master: FerruleDraft) {
  return [
    master.ferruleSeries,
    master.hoseConstruction,
    master.hoseTailDash,
    master.skiveRequirement,
    master.material,
    master.coating,
    master.source,
    master.notes,
  ] as const;
}

function adapterValues(master: AdapterDraft) {
  return [
    master.adapterFamilyId,
    master.skuTemplate,
    master.catalogModel,
    master.websiteProductName,
    master.shapeCode,
    master.interface1,
    master.connectionForm1,
    master.size1,
    master.interface2,
    master.connectionForm2,
    master.size2,
    master.interface3,
    master.connectionForm3,
    master.size3,
    master.websiteDisplay,
    master.source,
    master.notes,
  ] as const;
}

function adapterFamilyValues(master: AdapterDraft) {
  return [
    ...adapterValues(master),
    master.catalogPublicationStatus,
    master.rfqEligibility,
    master.technicalDataStatus,
  ] as const;
}

function quickCouplerValues(master: QuickCouplerDraft) {
  return [
    master.skuStandardCode,
    master.skuRoleCode,
    master.bodyDash,
    master.portCode,
    master.portDash,
    master.couplerSeries,
    master.role,
    master.matingSeries,
    master.interchangeStandard,
    master.bodySize,
    master.portInterface,
    master.portGender,
    master.portThread,
    master.connectionMechanism,
    master.valving,
    master.bodyMaterial,
    master.coating,
    master.sealMaterial,
    master.maxWorkingBar,
    master.minimumBurstBar,
    master.ratedFlowLMin,
    master.pressureDropBasis,
    master.tempMinC,
    master.tempMaxC,
    master.overallLengthMm,
    master.unitWeightG,
    master.drawingNumber,
    master.source,
    master.notes,
  ] as const;
}

function syncAdapterFamilyStatement(
  database: D1Database,
  operation: SaveManualComponentOperation,
  draft: ReleaseRow,
  master: AdapterDraft,
) {
  return database
    .prepare(
      `INSERT INTO catalog_adapter_families (
         id, import_id, adapter_family_id, sku_template, catalog_model,
         website_product_name, shape_code, interface_1, connection_form_1,
         size_1, interface_2, connection_form_2, size_2, interface_3,
         connection_form_3, size_3, website_display, source, notes,
         catalog_publication_status, rfq_eligibility, technical_data_status
       ) VALUES (?, ?, ${Array.from({ length: 20 }, (_, index) => `?${index + 3}`).join(", ")})
       ON CONFLICT(import_id, adapter_family_id) DO UPDATE SET
         sku_template = excluded.sku_template,
         catalog_model = excluded.catalog_model,
         website_product_name = excluded.website_product_name,
         shape_code = excluded.shape_code,
         interface_1 = excluded.interface_1,
         connection_form_1 = excluded.connection_form_1,
         size_1 = excluded.size_1,
         interface_2 = excluded.interface_2,
         connection_form_2 = excluded.connection_form_2,
         size_2 = excluded.size_2,
         interface_3 = excluded.interface_3,
         connection_form_3 = excluded.connection_form_3,
         size_3 = excluded.size_3,
         website_display = excluded.website_display,
         source = excluded.source,
         notes = excluded.notes,
         catalog_publication_status = excluded.catalog_publication_status,
         rfq_eligibility = excluded.rfq_eligibility,
         technical_data_status = excluded.technical_data_status`,
    )
    .bind(
      `${operation.componentId}:family`,
      draft.source_import_id,
      ...adapterFamilyValues(master),
    );
}

function componentMutationStatements(
  database: D1Database,
  operation: SaveManualComponentOperation,
  draft: ReleaseRow,
  imageAffectedSkus: string[],
) {
  const { master, productType, salesOffer } = operation;
  const worksheet = {
    adapter: "05_过渡接头",
    ferrule: "03_套筒",
    hose_end: "02_压接接头",
    quick_coupler: "06_快速接头",
  }[productType];
  const statements: D1PreparedStatement[] = [];
  if (productType === "hose_end") {
    const hoseEnd = master as HoseEndDraft;
    statements.push(
      ...approvedMediaStatements(
        database,
        operation.mainImageReference,
        operation.actorId,
        operation.occurredAt,
      ),
      database
        .prepare(
          `INSERT OR IGNORE INTO catalog_hose_end_series (
             id, import_id, series_code, series_name, interface_family,
             connection_standard, gender, swivel_form, angle, sealing_form,
             representative_media_version_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `${operation.componentId}:series:${hoseEnd.fittingSeries}`,
          draft.source_import_id,
          hoseEnd.fittingSeries,
          hoseEnd.fittingSeries,
          hoseEnd.interfaceFamily,
          hoseEnd.connectionStandard,
          hoseEnd.gender,
          hoseEnd.swivelForm,
          hoseEnd.angle,
          hoseEnd.sealingForm,
          resolvedMediaVersionId(operation.mainImageReference),
        ),
    );
  }
  if (operation.mode === "create") {
    statements.push(
      database
        .prepare(
          `INSERT INTO catalog_skus (
             id, import_id, sku, source_worksheet, product_type, hose_series,
             catalog_publication_status, rfq_eligibility,
             technical_data_status, supply_availability
           ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, COALESCE(?, 'temporarily_unavailable'))`,
        )
        .bind(
          operation.skuId,
          draft.source_import_id,
          master.sku,
          worksheet,
          productType,
          master.catalogPublicationStatus,
          master.rfqEligibility,
          master.technicalDataStatus,
          operation.supplyAvailability ?? null,
        ),
    );
    if (productType === "hose_end") {
      statements.push(
        database
          .prepare(
            `INSERT INTO catalog_hose_ends (
               id, import_id, sku, fitting_series, competitor_part_number,
               interface_family, connection_standard, gender, swivel_form,
               angle, sealing_form, thread, connection_dash, hose_tail_dash,
               material, coating, salt_spray_hours, max_working_bar,
               dimension_a_mm, cutoff_b_mm, hex_1_mm, hex_2_mm,
               minimum_bore_mm, unit_weight_g, drawing_number,
               drawing_revision, source, notes
             ) VALUES (?, ?, ?, ${Array.from({ length: 25 }, (_, index) => `?${index + 4}`).join(", ")})`,
          )
          .bind(
            operation.componentId,
            draft.source_import_id,
            master.sku,
            ...hoseEndValues(master as HoseEndDraft),
          ),
      );
    } else if (productType === "ferrule") {
      statements.push(
        database
          .prepare(
            `INSERT INTO catalog_ferrules (
               id, import_id, sku, ferrule_series, hose_construction,
               hose_tail_dash, skive_requirement, material, coating,
               source, notes
             ) VALUES (?, ?, ?, ${Array.from({ length: 8 }, (_, index) => `?${index + 4}`).join(", ")})`,
          )
          .bind(
            operation.componentId,
            draft.source_import_id,
            master.sku,
            ...ferruleValues(master as FerruleDraft),
          ),
      );
    } else if (productType === "adapter") {
      const adapter = master as AdapterDraft;
      statements.push(
        syncAdapterFamilyStatement(database, operation, draft, adapter),
        database
          .prepare(
            `INSERT INTO catalog_adapters (
               id, import_id, sku, adapter_family_id, sku_template,
               catalog_model, website_product_name, shape_code, interface_1,
               connection_form_1, size_1, interface_2, connection_form_2,
               size_2, interface_3, connection_form_3, size_3,
               website_display, source, notes
             ) VALUES (?, ?, ?, ${Array.from({ length: 17 }, (_, index) => `?${index + 4}`).join(", ")})`,
          )
          .bind(
            operation.componentId,
            draft.source_import_id,
            adapter.sku,
            ...adapterValues(adapter),
          ),
      );
    } else {
      const quickCoupler = master as QuickCouplerDraft;
      statements.push(
        database
          .prepare(
            `INSERT INTO catalog_quick_couplers (
               id, import_id, sku, sku_standard_code, sku_role_code,
               body_dash, port_code, port_dash, coupler_series, role,
               mating_series, interchange_standard, body_size, port_interface,
               port_gender, port_thread, connection_mechanism, valving,
               body_material, coating, seal_material, max_working_bar,
               minimum_burst_bar, rated_flow_l_min, pressure_drop_basis,
               temp_min_c, temp_max_c, overall_length_mm, unit_weight_g,
               drawing_number, source, notes
             ) VALUES (?, ?, ?, ${Array.from({ length: 29 }, (_, index) => `?${index + 4}`).join(", ")})`,
          )
          .bind(
            operation.componentId,
            draft.source_import_id,
            quickCoupler.sku,
            ...quickCouplerValues(quickCoupler),
          ),
      );
    }
    if (salesOffer) {
      statements.push(
        database
          .prepare(
            `INSERT INTO catalog_sales_offers (
             id, import_id, base_sku, sales_sku, product_type, sales_unit,
             package_length_ft, units_per_sales_pack, moq, net_unit_weight_kg,
             lead_time_days, country_of_origin, currency, reference_price_usd,
             inner_pack_qty, master_carton_qty, carton_gross_weight_kg,
             carton_l_cm, carton_w_cm, carton_h_cm, packing_basis, hs_code,
             notes, catalog_publication_status, rfq_eligibility,
             technical_data_status, quantity_input_mode,
             minimum_length_per_piece_ft, length_increment_ft,
             preset_length_1_ft, preset_length_2_ft, preset_length_3_ft,
             continuous_length_confirmation
           ) VALUES (?, ?, ?, ${Array.from({ length: 30 }, (_, index) => `?${index + 4}`).join(", ")})`,
          )
          .bind(
            operation.salesOfferId,
            draft.source_import_id,
            master.sku,
            ...salesValues(salesOffer),
          ),
        database
          .prepare(
            `INSERT INTO catalog_cost_bases (
             id, import_id, sales_sku, currency, factory_unit_price,
             price_incoterm, incoterm_place, tier_qty, tier_price
           ) VALUES (?, ?, ?, 'USD', NULL, NULL, NULL, NULL, NULL)`,
          )
          .bind(
            operation.costBasisId,
            draft.source_import_id,
            salesOffer.salesSku,
          ),
      );
    }
  } else {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_skus
           SET source_worksheet = ?, product_type = ?, hose_series = NULL,
               catalog_publication_status = ?, rfq_eligibility = ?,
               technical_data_status = ?,
               supply_availability = COALESCE(?, supply_availability)
           WHERE import_id = ? AND sku = ? AND product_type = ?`,
        )
        .bind(
          worksheet,
          productType,
          master.catalogPublicationStatus,
          master.rfqEligibility,
          master.technicalDataStatus,
          operation.supplyAvailability ?? null,
          draft.source_import_id,
          master.sku,
          productType,
        ),
    );
    if (productType === "hose_end") {
      statements.push(
        database
          .prepare(
            `UPDATE catalog_hose_ends
             SET fitting_series = ?, competitor_part_number = ?,
                 interface_family = ?, connection_standard = ?, gender = ?,
                 swivel_form = ?, angle = ?, sealing_form = ?, thread = ?,
                 connection_dash = ?, hose_tail_dash = ?, material = ?,
                 coating = ?, salt_spray_hours = ?, max_working_bar = ?,
                 dimension_a_mm = ?, cutoff_b_mm = ?, hex_1_mm = ?,
                 hex_2_mm = ?, minimum_bore_mm = ?, unit_weight_g = ?,
                 drawing_number = ?, drawing_revision = ?, source = ?, notes = ?
             WHERE import_id = ? AND sku = ?`,
          )
          .bind(
            ...hoseEndValues(master as HoseEndDraft),
            draft.source_import_id,
            master.sku,
          ),
      );
    } else if (productType === "ferrule") {
      statements.push(
        database
          .prepare(
            `UPDATE catalog_ferrules
             SET ferrule_series = ?, hose_construction = ?, hose_tail_dash = ?,
                 skive_requirement = ?, material = ?, coating = ?, source = ?,
                 notes = ?
             WHERE import_id = ? AND sku = ?`,
          )
          .bind(
            ...ferruleValues(master as FerruleDraft),
            draft.source_import_id,
            master.sku,
          ),
      );
    } else if (productType === "adapter") {
      const adapter = master as AdapterDraft;
      statements.push(
        syncAdapterFamilyStatement(database, operation, draft, adapter),
        database
          .prepare(
            `UPDATE catalog_adapters
             SET adapter_family_id = ?, sku_template = ?, catalog_model = ?,
                 website_product_name = ?, shape_code = ?, interface_1 = ?,
                 connection_form_1 = ?, size_1 = ?, interface_2 = ?,
                 connection_form_2 = ?, size_2 = ?, interface_3 = ?,
                 connection_form_3 = ?, size_3 = ?, website_display = ?,
                 source = ?, notes = ?
             WHERE import_id = ? AND sku = ?`,
          )
          .bind(...adapterValues(adapter), draft.source_import_id, adapter.sku),
      );
    } else {
      const quickCoupler = master as QuickCouplerDraft;
      statements.push(
        database
          .prepare(
            `UPDATE catalog_quick_couplers
             SET sku_standard_code = ?, sku_role_code = ?, body_dash = ?,
                 port_code = ?, port_dash = ?, coupler_series = ?, role = ?,
                 mating_series = ?, interchange_standard = ?, body_size = ?,
                 port_interface = ?, port_gender = ?, port_thread = ?,
                 connection_mechanism = ?, valving = ?, body_material = ?,
                 coating = ?, seal_material = ?, max_working_bar = ?,
                 minimum_burst_bar = ?, rated_flow_l_min = ?,
                 pressure_drop_basis = ?, temp_min_c = ?, temp_max_c = ?,
                 overall_length_mm = ?, unit_weight_g = ?, drawing_number = ?,
                 source = ?, notes = ?
             WHERE import_id = ? AND sku = ?`,
          )
          .bind(
            ...quickCouplerValues(quickCoupler),
            draft.source_import_id,
            quickCoupler.sku,
          ),
      );
    }
    if (salesOffer) {
      statements.push(
        database
          .prepare(
            `UPDATE catalog_sales_offers
           SET sales_sku = ?, product_type = ?, sales_unit = ?,
               package_length_ft = ?, units_per_sales_pack = ?, moq = ?,
               net_unit_weight_kg = ?, lead_time_days = ?, country_of_origin = ?,
               currency = ?, reference_price_usd = ?, inner_pack_qty = ?,
               master_carton_qty = ?, carton_gross_weight_kg = ?, carton_l_cm = ?,
               carton_w_cm = ?, carton_h_cm = ?, packing_basis = ?, hs_code = ?,
               notes = ?, catalog_publication_status = ?, rfq_eligibility = ?,
               technical_data_status = ?, quantity_input_mode = ?,
               minimum_length_per_piece_ft = ?, length_increment_ft = ?,
               preset_length_1_ft = ?, preset_length_2_ft = ?, preset_length_3_ft = ?,
               continuous_length_confirmation = ?
           WHERE import_id = ? AND base_sku = ?`,
          )
          .bind(...salesValues(salesOffer), draft.source_import_id, master.sku),
      );
    }
  }

  statements.push(
    ...mainImageMutationStatements(
      database,
      operation,
      draft,
      master.sku,
      imageAffectedSkus,
    ),
  );
  if (productType === "hose_end") {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_hose_end_series
           SET representative_media_version_id = COALESCE(
             representative_media_version_id, ?
           )
           WHERE import_id = ? AND series_code = ?`,
        )
        .bind(
          resolvedMediaVersionId(operation.mainImageReference),
          draft.source_import_id,
          (master as HoseEndDraft).fittingSeries,
        ),
    );
  }
  statements.push(
    database
      .prepare(
        `UPDATE catalog_imports
         SET summary_json = json_set(
           summary_json,
           '$.skuCount', (SELECT COUNT(*) FROM catalog_skus WHERE import_id = ?1),
           '$.hoseEndCount', (SELECT COUNT(*) FROM catalog_hose_ends WHERE import_id = ?1),
           '$.ferruleCount', (SELECT COUNT(*) FROM catalog_ferrules WHERE import_id = ?1),
           '$.compatibilityCount', (SELECT COUNT(*) FROM catalog_compatibilities WHERE import_id = ?1),
           '$.adapterFamilyCount', (SELECT COUNT(*) FROM catalog_adapter_families WHERE import_id = ?1),
           '$.adapterCount', (SELECT COUNT(*) FROM catalog_adapters WHERE import_id = ?1),
           '$.quickCouplerCount', (SELECT COUNT(*) FROM catalog_quick_couplers WHERE import_id = ?1),
           '$.salesOfferCount', (SELECT COUNT(*) FROM catalog_sales_offers WHERE import_id = ?1),
           '$.referencePriceCount', (SELECT COUNT(*) FROM catalog_sales_offers WHERE import_id = ?1 AND reference_price_usd IS NOT NULL)
         ) WHERE id = ?1`,
      )
      .bind(draft.source_import_id),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, ?, 'catalog_sku', ?, ?, ?, ?)`,
      )
      .bind(
        operation.auditEventId,
        `catalog_manual.${productType}_${operation.mode === "create" ? "created" : "updated"}`,
        master.sku,
        operation.actorId,
        JSON.stringify({
          draftReleaseId: draft.id,
          mainImageReference: operation.mainImageReference,
          productType,
          referencePriceUsd: salesOffer?.referencePriceUsd ?? null,
          salesSku: salesOffer?.salesSku ?? null,
        }),
        operation.occurredAt,
      ),
  );
  return statements;
}

function toManualHoseRecord(
  row: HoseRow,
  release: ReleaseRow,
): ManualHoseRecord {
  return {
    hose: {
      bendRadiusMm: row.bend_radius_mm,
      burstBar: row.burst_bar,
      catalogPublicationStatus: row.catalog_publication_status,
      coverColor: row.cover_color,
      coverFinish: row.cover_finish,
      coverMaterial: row.cover_material,
      dash: row.dash,
      equivalentStandard: row.equivalent_standard,
      fluidCompatibility: row.fluid_compatibility,
      hoseSeries: row.hose_series,
      idMm: row.id_mm,
      mshaMarking: row.msha_marking,
      nominalIdIn: row.nominal_id_in,
      notes: row.notes,
      odMm: row.od_mm,
      origin: row.origin,
      primaryStandard: row.primary_standard,
      reinforcement: row.reinforcement,
      rfqEligibility: row.rfq_eligibility,
      skiveRequirement: row.skive_requirement,
      sku: row.sku,
      source: row.source,
      technicalDataStatus: row.technical_data_status,
      tempMaxC: row.temp_max_c,
      tempMinC: row.temp_min_c,
      tubeMaterial: row.tube_material,
      weightKgM: row.weight_kg_m,
      workingBar: row.working_bar,
      workingPsi: row.working_psi,
    },
    mainImageReference:
      row.main_image_reference || `hose-series:${row.hose_series}`,
    release: {
      id: release.id,
      releaseNumber: release.release_number,
      status: release.status,
    },
    salesOffer: {
      baseSku: row.sku,
      catalogPublicationStatus: row.catalog_publication_status,
      cartonGrossWeightKg: row.carton_gross_weight_kg,
      cartonHCm: row.carton_h_cm,
      cartonLCm: row.carton_l_cm,
      cartonWCm: row.carton_w_cm,
      continuousLengthConfirmation: row.continuous_length_confirmation,
      countryOfOrigin: row.country_of_origin,
      currency: row.currency,
      hsCode: row.hs_code,
      innerPackQty: row.inner_pack_qty,
      leadTimeDays: row.lead_time_days,
      lengthIncrementFt: row.length_increment_ft,
      masterCartonQty: row.master_carton_qty,
      minimumLengthPerPieceFt: row.minimum_length_per_piece_ft,
      moq: row.moq,
      netUnitWeightKg: row.net_unit_weight_kg,
      notes: row.sales_notes,
      packageLengthFt: row.package_length_ft,
      packingBasis: row.packing_basis,
      presetLength1Ft: row.preset_length_1_ft,
      presetLength2Ft: row.preset_length_2_ft,
      presetLength3Ft: row.preset_length_3_ft,
      productType: row.product_type,
      quantityInputMode: row.quantity_input_mode,
      referencePriceUsd: row.reference_price_usd,
      rfqEligibility: row.rfq_eligibility,
      salesSku: row.sales_sku,
      salesUnit: row.sales_unit,
      technicalDataStatus: row.technical_data_status,
      unitsPerSalesPack: row.units_per_sales_pack,
    },
    supplyAvailability: row.supply_availability,
  };
}

function toHoseSeriesRecord(row: HoseSeriesRow): HoseSeriesRecord {
  return {
    coverColor: row.cover_color,
    coverFinish: row.cover_finish,
    coverMaterial: row.cover_material,
    equivalentStandard: row.equivalent_standard,
    fluidCompatibility: row.fluid_compatibility,
    primaryStandard: row.primary_standard,
    reinforcement: row.reinforcement,
    representativeImageReference: row.representative_image_reference,
    seriesCode: row.series_code,
    seriesName: row.series_name,
    tempMaxC: row.temp_max_c,
    tempMinC: row.temp_min_c,
    tubeMaterial: row.tube_material,
  };
}

function toHoseVariantRecord(
  row: HoseVariantMaintenanceRow,
): HoseVariantRecord {
  return {
    bendRadiusMm: row.bend_radius_mm,
    burstBar: row.burst_bar,
    dash: row.dash,
    hoseSeries: row.hose_series,
    idMm: row.id_mm,
    imageOverrideReference: row.image_override_reference,
    lifecycleStatus: inferProductLifecycleStatus({
      catalogPublicationStatus: row.catalog_publication_status,
      supplyAvailability: row.supply_availability,
    }),
    mshaMarking: row.msha_marking,
    nominalIdIn: row.nominal_id_in,
    notes: row.notes,
    odMm: row.od_mm,
    skiveRequirement: row.skive_requirement,
    sku: row.sku,
    source: row.source,
    technicalDataStatus: row.technical_data_status,
    weightKgM: row.weight_kg_m,
    workingBar: row.working_bar,
    workingPsi: row.working_psi,
  };
}

const hoseSeriesSelect = `
  SELECT series.series_code, series.series_name, series.primary_standard,
         series.equivalent_standard, series.temp_min_c, series.temp_max_c,
         series.tube_material, series.reinforcement, series.cover_material,
         series.cover_color, series.cover_finish, series.fluid_compatibility,
         COALESCE(media.approved_reference, 'media-version:' || media.id, '')
           AS representative_image_reference
  FROM catalog_hose_series series
  INNER JOIN catalog_media_versions media
    ON media.id = series.representative_media_version_id
  WHERE series.import_id = ?`;

function toHoseEndSeriesRecord(
  row: HoseEndSeriesMaintenanceRow,
): HoseEndSeriesRecord {
  return {
    angle: row.angle,
    gender: row.gender,
    interfaceFamily: row.interface_family,
    interfaceStandard: row.interface_standard,
    representativeImageReference: row.representative_image_reference,
    sealingForm: row.sealing_form,
    seriesCode: row.series_code,
    seriesName: row.series_name,
    swivelForm: row.swivel_form,
  };
}

function toHoseEndVariantRecord(
  row: HoseEndVariantMaintenanceRow,
): HoseEndVariantRecord {
  return {
    coating: row.coating,
    competitorPartNumber: row.competitor_part_number,
    connectionDash: row.connection_dash,
    cutoffBMm: row.cutoff_b_mm,
    dimensionAMm: row.dimension_a_mm,
    drawingNumber: row.drawing_number,
    drawingRevision: row.drawing_revision,
    fittingSeries: row.fitting_series,
    hex1Mm: row.hex_1_mm,
    hex2Mm: row.hex_2_mm,
    hoseTailDash: row.hose_tail_dash,
    imageOverrideReference: row.image_override_reference,
    lifecycleStatus: inferProductLifecycleStatus({
      catalogPublicationStatus: row.catalog_publication_status,
      supplyAvailability: row.supply_availability,
    }),
    material: row.material,
    maxWorkingBar: row.max_working_bar,
    minimumBoreMm: row.minimum_bore_mm,
    notes: row.notes,
    saltSprayHours: row.salt_spray_hours,
    sku: row.sku,
    source: row.source,
    technicalDataStatus: row.technical_data_status,
    thread: row.thread,
    unitWeightG: row.unit_weight_g,
  };
}

const hoseEndSeriesSelect = `
  SELECT series.series_code, series.series_name, series.interface_family,
         series.connection_standard AS interface_standard, series.gender,
         series.swivel_form, series.angle, series.sealing_form,
         COALESCE(media.approved_reference, 'media-version:' || media.id, '')
           AS representative_image_reference
  FROM catalog_hose_end_series series
  INNER JOIN catalog_media_versions media
    ON media.id = series.representative_media_version_id
  WHERE series.import_id = ?`;

function catalogSummaryStatement(database: D1Database, importId: string) {
  return database
    .prepare(
      `UPDATE catalog_imports
       SET summary_json = json_set(
         summary_json,
         '$.skuCount', (SELECT COUNT(*) FROM catalog_skus WHERE import_id = ?1),
         '$.hoseSeriesCount', (SELECT COUNT(*) FROM catalog_hose_series WHERE import_id = ?1),
         '$.hoseVariantCount', (SELECT COUNT(*) FROM catalog_hose_variants WHERE import_id = ?1),
         '$.hoseEndSeriesCount', (SELECT COUNT(*) FROM catalog_hose_end_series WHERE import_id = ?1),
         '$.hoseEndCount', (SELECT COUNT(*) FROM catalog_hose_ends WHERE import_id = ?1)
       )
       WHERE id = ?1`,
    )
    .bind(importId);
}

function hoseEndSeriesMutationStatements(
  database: D1Database,
  operation: SaveHoseEndSeriesOperation,
  draft: ReleaseRow,
) {
  const { series } = operation;
  const statements: D1PreparedStatement[] = [
    ...approvedMediaStatements(
      database,
      series.representativeImageReference,
      operation.actorId,
      operation.occurredAt,
    ),
  ];
  if (operation.mode === "create") {
    statements.push(
      database
        .prepare(
          `INSERT INTO catalog_hose_end_series (
             id, import_id, series_code, series_name, interface_family,
             connection_standard, gender, swivel_form, angle, sealing_form,
             representative_media_version_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          operation.seriesId,
          draft.source_import_id,
          series.seriesCode,
          series.seriesName,
          series.interfaceFamily,
          series.interfaceStandard,
          series.gender,
          series.swivelForm,
          series.angle,
          series.sealingForm,
          resolvedMediaVersionId(series.representativeImageReference),
        ),
    );
  } else {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_hose_end_series
           SET series_name = ?, interface_family = ?, connection_standard = ?,
               gender = ?, swivel_form = ?, angle = ?, sealing_form = ?,
               representative_media_version_id = ?
           WHERE import_id = ? AND series_code = ?`,
        )
        .bind(
          series.seriesName,
          series.interfaceFamily,
          series.interfaceStandard,
          series.gender,
          series.swivelForm,
          series.angle,
          series.sealingForm,
          resolvedMediaVersionId(series.representativeImageReference),
          draft.source_import_id,
          series.seriesCode,
        ),
      database
        .prepare(
          `UPDATE catalog_hose_ends
           SET interface_family = ?, connection_standard = ?, gender = ?,
               swivel_form = ?, angle = ?, sealing_form = ?
           WHERE import_id = ? AND fitting_series = ?`,
        )
        .bind(
          series.interfaceFamily,
          series.interfaceStandard,
          series.gender,
          series.swivelForm,
          series.angle,
          series.sealingForm,
          draft.source_import_id,
          series.seriesCode,
        ),
    );
  }
  statements.push(
    catalogSummaryStatement(database, draft.source_import_id),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, ?, 'catalog_hose_end_series', ?, ?, ?, ?)`,
      )
      .bind(
        operation.auditEventId,
        operation.mode === "create"
          ? "catalog_manual.hose_end_series_created"
          : "catalog_manual.hose_end_series_updated",
        series.seriesCode,
        operation.actorId,
        JSON.stringify({
          draftReleaseId: draft.id,
          representativeImageReference: series.representativeImageReference,
          seriesName: series.seriesName,
        }),
        operation.occurredAt,
      ),
  );
  return statements;
}

function hoseEndVariantMutationStatements(
  database: D1Database,
  operation: SaveHoseEndVariantOperation,
  draft: ReleaseRow,
) {
  const { lifecycle, series, variant } = operation;
  const technicalDataStatus = variant.technicalDataStatus ?? "Pending";
  const variantValues = [
    variant.fittingSeries,
    variant.competitorPartNumber,
    series.interfaceFamily,
    series.interfaceStandard,
    series.gender,
    series.swivelForm,
    series.angle,
    series.sealingForm,
    variant.thread,
    variant.connectionDash,
    variant.hoseTailDash,
    variant.material,
    variant.coating,
    variant.saltSprayHours,
    variant.maxWorkingBar,
    variant.dimensionAMm,
    variant.cutoffBMm,
    variant.hex1Mm,
    variant.hex2Mm,
    variant.minimumBoreMm,
    variant.unitWeightG,
    variant.drawingNumber,
    variant.drawingRevision,
    variant.source ?? "",
    variant.notes,
  ] as const;
  const statements: D1PreparedStatement[] = [];
  if (operation.mode === "create") {
    statements.push(
      database
        .prepare(
          `INSERT INTO catalog_skus (
             id, import_id, sku, source_worksheet, product_type, hose_series,
             catalog_publication_status, rfq_eligibility,
             technical_data_status, supply_availability
           ) VALUES (?, ?, ?, '02_压接接头', 'hose_end', NULL, ?, ?, ?, ?)`,
        )
        .bind(
          operation.skuId,
          draft.source_import_id,
          variant.sku,
          lifecycle.catalogPublicationStatus,
          lifecycle.rfqEligibility,
          technicalDataStatus,
          lifecycle.supplyAvailability,
        ),
      database
        .prepare(
          `INSERT INTO catalog_hose_ends (
             id, import_id, sku, fitting_series, competitor_part_number,
             interface_family, connection_standard, gender, swivel_form,
             angle, sealing_form, thread, connection_dash, hose_tail_dash,
             material, coating, salt_spray_hours, max_working_bar,
             dimension_a_mm, cutoff_b_mm, hex_1_mm, hex_2_mm,
             minimum_bore_mm, unit_weight_g, drawing_number,
             drawing_revision, source, notes
           ) VALUES (?, ?, ?, ${Array.from({ length: 25 }, (_, index) => `?${index + 4}`).join(", ")})`,
        )
        .bind(
          operation.variantId,
          draft.source_import_id,
          variant.sku,
          ...variantValues,
        ),
    );
  } else {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_skus
           SET catalog_publication_status = ?, rfq_eligibility = ?,
               technical_data_status = ?, supply_availability = ?
           WHERE import_id = ? AND sku = ? AND product_type = 'hose_end'`,
        )
        .bind(
          lifecycle.catalogPublicationStatus,
          lifecycle.rfqEligibility,
          technicalDataStatus,
          lifecycle.supplyAvailability,
          draft.source_import_id,
          variant.sku,
        ),
      database
        .prepare(
          `UPDATE catalog_hose_ends
           SET fitting_series = ?, competitor_part_number = ?,
               interface_family = ?, connection_standard = ?, gender = ?,
               swivel_form = ?, angle = ?, sealing_form = ?, thread = ?,
               connection_dash = ?, hose_tail_dash = ?, material = ?,
               coating = ?, salt_spray_hours = ?, max_working_bar = ?,
               dimension_a_mm = ?, cutoff_b_mm = ?, hex_1_mm = ?, hex_2_mm = ?,
               minimum_bore_mm = ?, unit_weight_g = ?, drawing_number = ?,
               drawing_revision = ?, source = ?, notes = ?
           WHERE import_id = ? AND sku = ?`,
        )
        .bind(...variantValues, draft.source_import_id, variant.sku),
      database
        .prepare(
          `UPDATE catalog_sales_offers
           SET catalog_publication_status = ?, rfq_eligibility = ?,
               technical_data_status = ?
           WHERE import_id = ? AND base_sku = ?`,
        )
        .bind(
          lifecycle.catalogPublicationStatus,
          lifecycle.rfqEligibility,
          technicalDataStatus,
          draft.source_import_id,
          variant.sku,
        ),
    );
  }
  if (operation.imageOverrideReference) {
    statements.push(
      ...approvedMediaStatements(
        database,
        operation.imageOverrideReference,
        operation.actorId,
        operation.occurredAt,
      ),
      database
        .prepare(
          `INSERT INTO catalog_product_main_images (
             id, import_id, sku, media_version_id, assigned_at, assigned_by,
             assignment_kind
           ) VALUES (?, ?, ?, ?, ?, ?, 'override')
           ON CONFLICT(import_id, sku) DO UPDATE SET
             media_version_id = excluded.media_version_id,
             assigned_at = excluded.assigned_at,
             assigned_by = excluded.assigned_by,
             assignment_kind = 'override'`,
        )
        .bind(
          operation.mediaAssignmentId,
          draft.source_import_id,
          variant.sku,
          resolvedMediaVersionId(operation.imageOverrideReference),
          operation.occurredAt,
          operation.actorId,
        ),
    );
  } else {
    statements.push(
      database
        .prepare(
          `DELETE FROM catalog_product_main_images
           WHERE import_id = ? AND sku = ?`,
        )
        .bind(draft.source_import_id, variant.sku),
    );
  }
  statements.push(
    catalogSummaryStatement(database, draft.source_import_id),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, ?, 'catalog_sku', ?, ?, ?, ?)`,
      )
      .bind(
        operation.auditEventId,
        operation.mode === "create"
          ? "catalog_manual.hose_end_variant_created"
          : "catalog_manual.hose_end_variant_updated",
        variant.sku,
        operation.actorId,
        JSON.stringify({
          draftReleaseId: draft.id,
          fittingSeries: variant.fittingSeries,
          imageOverrideReference: operation.imageOverrideReference,
          lifecycleStatus: inferProductLifecycleStatus({
            catalogPublicationStatus: lifecycle.catalogPublicationStatus,
            supplyAvailability: lifecycle.supplyAvailability,
          }),
        }),
        operation.occurredAt,
      ),
  );
  return statements;
}

function hoseSeriesMutationStatements(
  database: D1Database,
  operation: SaveHoseSeriesOperation,
  draft: ReleaseRow,
) {
  const { series } = operation;
  const statements: D1PreparedStatement[] = [
    ...approvedMediaStatements(
      database,
      series.representativeImageReference,
      operation.actorId,
      operation.occurredAt,
    ),
  ];
  if (operation.mode === "create") {
    statements.push(
      database
        .prepare(
          `INSERT INTO catalog_hose_series (
             id, import_id, series_code, series_name, primary_standard,
             equivalent_standard, temp_min_c, temp_max_c, tube_material,
             reinforcement, cover_material, cover_color, cover_finish,
             fluid_compatibility, representative_media_version_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          operation.seriesId,
          draft.source_import_id,
          series.seriesCode,
          series.seriesName,
          series.primaryStandard,
          series.equivalentStandard,
          series.tempMinC,
          series.tempMaxC,
          series.tubeMaterial,
          series.reinforcement,
          series.coverMaterial,
          series.coverColor,
          series.coverFinish,
          series.fluidCompatibility,
          resolvedMediaVersionId(series.representativeImageReference),
        ),
    );
  } else {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_hose_series
           SET series_name = ?, primary_standard = ?, equivalent_standard = ?,
               temp_min_c = ?, temp_max_c = ?, tube_material = ?,
               reinforcement = ?, cover_material = ?, cover_color = ?,
               cover_finish = ?, fluid_compatibility = ?,
               representative_media_version_id = ?
           WHERE import_id = ? AND series_code = ?`,
        )
        .bind(
          series.seriesName,
          series.primaryStandard,
          series.equivalentStandard,
          series.tempMinC,
          series.tempMaxC,
          series.tubeMaterial,
          series.reinforcement,
          series.coverMaterial,
          series.coverColor,
          series.coverFinish,
          series.fluidCompatibility,
          resolvedMediaVersionId(series.representativeImageReference),
          draft.source_import_id,
          series.seriesCode,
        ),
    );
  }
  statements.push(
    catalogSummaryStatement(database, draft.source_import_id),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, ?, 'catalog_hose_series', ?, ?, ?, ?)`,
      )
      .bind(
        operation.auditEventId,
        operation.mode === "create"
          ? "catalog_manual.hose_series_created"
          : "catalog_manual.hose_series_updated",
        series.seriesCode,
        operation.actorId,
        JSON.stringify({
          draftReleaseId: draft.id,
          representativeImageReference: series.representativeImageReference,
          seriesName: series.seriesName,
        }),
        operation.occurredAt,
      ),
  );
  return statements;
}

function hoseVariantMutationStatements(
  database: D1Database,
  operation: SaveHoseVariantOperation,
  draft: ReleaseRow,
) {
  const { lifecycle, series, variant } = operation;
  const technicalDataStatus = variant.technicalDataStatus ?? "Pending";
  const variantValues = [
    variant.hoseSeries,
    series.primaryStandard,
    series.equivalentStandard,
    variant.dash,
    variant.nominalIdIn,
    variant.idMm,
    variant.odMm,
    variant.workingBar,
    variant.workingPsi,
    variant.burstBar,
    variant.bendRadiusMm,
    variant.weightKgM,
    series.tempMinC,
    series.tempMaxC,
    series.tubeMaterial ?? "",
    series.reinforcement ?? "",
    series.coverMaterial ?? "",
    series.coverColor ?? "",
    series.coverFinish,
    variant.skiveRequirement ?? "",
    variant.mshaMarking,
    series.fluidCompatibility ?? "",
    "",
    variant.source ?? "",
    variant.notes,
  ] as const;
  const statements: D1PreparedStatement[] = [];
  if (operation.mode === "create") {
    statements.push(
      database
        .prepare(
          `INSERT INTO catalog_skus (
             id, import_id, sku, source_worksheet, product_type, hose_series,
             catalog_publication_status, rfq_eligibility,
             technical_data_status, supply_availability
           ) VALUES (?, ?, ?, '01_胶管主数据', 'hose', ?, ?, ?, ?, ?)`,
        )
        .bind(
          operation.skuId,
          draft.source_import_id,
          variant.sku,
          variant.hoseSeries,
          lifecycle.catalogPublicationStatus,
          lifecycle.rfqEligibility,
          technicalDataStatus,
          lifecycle.supplyAvailability,
        ),
      database
        .prepare(
          `INSERT INTO catalog_hose_variants (
             id, import_id, sku, hose_series, primary_standard,
             equivalent_standard, dash, nominal_id_in, id_mm, od_mm,
             working_bar, working_psi, burst_bar, bend_radius_mm, weight_kg_m,
             temp_min_c, temp_max_c, tube_material, reinforcement,
             cover_material, cover_color, cover_finish, skive_requirement,
             msha_marking, fluid_compatibility, origin, source, notes
           ) VALUES (?, ?, ?, ${Array.from({ length: 25 }, (_, index) => `?${index + 4}`).join(", ")})`,
        )
        .bind(
          operation.variantId,
          draft.source_import_id,
          variant.sku,
          ...variantValues,
        ),
    );
  } else {
    statements.push(
      database
        .prepare(
          `UPDATE catalog_skus
           SET hose_series = ?, catalog_publication_status = ?,
               rfq_eligibility = ?, technical_data_status = ?,
               supply_availability = ?
           WHERE import_id = ? AND sku = ? AND product_type = 'hose'`,
        )
        .bind(
          variant.hoseSeries,
          lifecycle.catalogPublicationStatus,
          lifecycle.rfqEligibility,
          technicalDataStatus,
          lifecycle.supplyAvailability,
          draft.source_import_id,
          variant.sku,
        ),
      database
        .prepare(
          `UPDATE catalog_hose_variants
           SET hose_series = ?, primary_standard = ?, equivalent_standard = ?,
               dash = ?, nominal_id_in = ?, id_mm = ?, od_mm = ?,
               working_bar = ?, working_psi = ?, burst_bar = ?,
               bend_radius_mm = ?, weight_kg_m = ?, temp_min_c = ?,
               temp_max_c = ?, tube_material = ?, reinforcement = ?,
               cover_material = ?, cover_color = ?, cover_finish = ?,
               skive_requirement = ?, msha_marking = ?, fluid_compatibility = ?,
               origin = ?, source = ?, notes = ?
           WHERE import_id = ? AND sku = ?`,
        )
        .bind(...variantValues, draft.source_import_id, variant.sku),
      database
        .prepare(
          `UPDATE catalog_sales_offers
           SET catalog_publication_status = ?, rfq_eligibility = ?,
               technical_data_status = ?
           WHERE import_id = ? AND base_sku = ?`,
        )
        .bind(
          lifecycle.catalogPublicationStatus,
          lifecycle.rfqEligibility,
          technicalDataStatus,
          draft.source_import_id,
          variant.sku,
        ),
    );
  }
  if (operation.imageOverrideReference) {
    statements.push(
      ...approvedMediaStatements(
        database,
        operation.imageOverrideReference,
        operation.actorId,
        operation.occurredAt,
      ),
      database
        .prepare(
          `INSERT INTO catalog_product_main_images (
             id, import_id, sku, media_version_id, assigned_at, assigned_by,
             assignment_kind
           ) VALUES (?, ?, ?, ?, ?, ?, 'override')
           ON CONFLICT(import_id, sku) DO UPDATE SET
             media_version_id = excluded.media_version_id,
             assigned_at = excluded.assigned_at,
             assigned_by = excluded.assigned_by,
             assignment_kind = 'override'`,
        )
        .bind(
          operation.mediaAssignmentId,
          draft.source_import_id,
          variant.sku,
          resolvedMediaVersionId(operation.imageOverrideReference),
          operation.occurredAt,
          operation.actorId,
        ),
    );
  } else {
    statements.push(
      database
        .prepare(
          `DELETE FROM catalog_product_main_images
           WHERE import_id = ? AND sku = ?`,
        )
        .bind(draft.source_import_id, variant.sku),
    );
  }
  statements.push(
    catalogSummaryStatement(database, draft.source_import_id),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, ?, 'catalog_sku', ?, ?, ?, ?)`,
      )
      .bind(
        operation.auditEventId,
        operation.mode === "create"
          ? "catalog_manual.hose_variant_created"
          : "catalog_manual.hose_variant_updated",
        variant.sku,
        operation.actorId,
        JSON.stringify({
          draftReleaseId: draft.id,
          hoseSeries: variant.hoseSeries,
          imageOverrideReference: operation.imageOverrideReference,
          lifecycleStatus: inferProductLifecycleStatus({
            catalogPublicationStatus: lifecycle.catalogPublicationStatus,
            supplyAvailability: lifecycle.supplyAvailability,
          }),
        }),
        operation.occurredAt,
      ),
  );
  return statements;
}

export function createD1CatalogManualHoseRepository(
  database: D1Database,
): CatalogHoseEndMaintenanceRepository &
  CatalogHoseMaintenanceRepository &
  CatalogManualComponentRepository &
  CatalogManualHoseRepository {
  return {
    async auditManualComponentRejection(rejection) {
      await database
        .prepare(
          `INSERT INTO admin_audit_events (
             id, event_type, entity_type, entity_id,
             actor_id, payload_json, occurred_at
           ) VALUES (?, 'catalog_manual.component_rejected', 'catalog_sku', ?, ?, ?, ?)`,
        )
        .bind(
          rejection.auditEventId,
          rejection.sku || "unknown",
          rejection.actorId,
          JSON.stringify({
            findingCodes: rejection.findingCodes,
            productType: rejection.productType,
            reason: rejection.reason,
          }),
          rejection.occurredAt,
        )
        .run();
    },

    async findComponentByExactSku(productType, sku) {
      const release = await findMaintenanceRelease(database);
      if (!release) return null;
      const table = {
        adapter: "catalog_adapters",
        ferrule: "catalog_ferrules",
        hose_end: "catalog_hose_ends",
        quick_coupler: "catalog_quick_couplers",
      }[productType];
      const row = await database
        .prepare(
          `SELECT component.*, product.catalog_publication_status,
                  product.rfq_eligibility, product.technical_data_status,
                  product.supply_availability,
                  offer.sales_sku, offer.product_type, offer.sales_unit,
                  offer.package_length_ft, offer.units_per_sales_pack,
                  offer.moq, offer.net_unit_weight_kg, offer.lead_time_days,
                  offer.country_of_origin, offer.currency,
                  offer.reference_price_usd, offer.inner_pack_qty,
                  offer.master_carton_qty, offer.carton_gross_weight_kg,
                  offer.carton_l_cm, offer.carton_w_cm, offer.carton_h_cm,
                  offer.packing_basis, offer.hs_code,
                  offer.notes AS sales_notes, offer.quantity_input_mode,
                  offer.minimum_length_per_piece_ft, offer.length_increment_ft,
                  offer.preset_length_1_ft, offer.preset_length_2_ft,
                  offer.preset_length_3_ft,
                  offer.continuous_length_confirmation,
                  COALESCE(media.approved_reference,
                           'media-version:' || media.id, '') AS main_image_reference
           FROM catalog_skus product
           INNER JOIN ${table} component
             ON component.import_id = product.import_id
            AND component.sku = product.sku
           LEFT JOIN catalog_sales_offers offer
             ON offer.import_id = product.import_id
            AND offer.base_sku = product.sku
           LEFT JOIN catalog_product_main_images image
             ON image.import_id = product.import_id AND image.sku = product.sku
           LEFT JOIN catalog_media_versions media
             ON media.id = image.media_version_id
           WHERE product.import_id = ? AND product.sku = ?
             AND product.product_type = ?`,
        )
        .bind(release.source_import_id, sku.trim().toUpperCase(), productType)
        .first<AdapterRow | FerruleRow | HoseEndRow | QuickCouplerRow>();
      return row ? toManualComponentRecord(row, release, productType) : null;
    },

    async findHoseByExactSku(sku) {
      const release = await findMaintenanceRelease(database);
      if (!release) return null;
      const row = await database
        .prepare(
          `SELECT hose.*, product.catalog_publication_status,
                  product.rfq_eligibility, product.technical_data_status,
                  product.supply_availability,
                  offer.sales_sku, offer.product_type, offer.sales_unit,
                  offer.package_length_ft, offer.units_per_sales_pack,
                  offer.moq, offer.net_unit_weight_kg, offer.lead_time_days,
                  offer.country_of_origin, offer.currency,
                  offer.reference_price_usd, offer.inner_pack_qty,
                  offer.master_carton_qty, offer.carton_gross_weight_kg,
                  offer.carton_l_cm, offer.carton_w_cm, offer.carton_h_cm,
                  offer.packing_basis, offer.hs_code,
                  offer.notes AS sales_notes, offer.quantity_input_mode,
                  offer.minimum_length_per_piece_ft, offer.length_increment_ft,
                  offer.preset_length_1_ft, offer.preset_length_2_ft,
                  offer.preset_length_3_ft,
                  offer.continuous_length_confirmation,
                  COALESCE(media.approved_reference,
                           'media-version:' || media.id, '') AS main_image_reference
           FROM catalog_skus product
           INNER JOIN catalog_hose_variants hose
             ON hose.import_id = product.import_id AND hose.sku = product.sku
           INNER JOIN catalog_sales_offers offer
             ON offer.import_id = product.import_id AND offer.base_sku = product.sku
           LEFT JOIN catalog_product_main_images image
             ON image.import_id = product.import_id AND image.sku = product.sku
           LEFT JOIN catalog_media_versions media
             ON media.id = image.media_version_id
           WHERE product.import_id = ? AND product.sku = ?
             AND product.product_type = 'hose'`,
        )
        .bind(release.source_import_id, sku.trim().toUpperCase())
        .first<HoseRow>();
      return row ? toManualHoseRecord(row, release) : null;
    },

    async findHoseEndSeries(seriesCode) {
      const release = await findMaintenanceRelease(database);
      if (!release) return null;
      const row = await database
        .prepare(`${hoseEndSeriesSelect} AND series.series_code = ?`)
        .bind(release.source_import_id, seriesCode.trim().toUpperCase())
        .first<HoseEndSeriesMaintenanceRow>();
      return row ? toHoseEndSeriesRecord(row) : null;
    },

    async findHoseEndVariant(sku) {
      const release = await findMaintenanceRelease(database);
      if (!release) return null;
      const row = await database
        .prepare(
          `SELECT variant.sku, variant.fitting_series, variant.thread,
                  variant.connection_dash, variant.hose_tail_dash,
                  variant.material, variant.coating, variant.salt_spray_hours,
                  variant.max_working_bar, variant.dimension_a_mm,
                  variant.cutoff_b_mm, variant.hex_1_mm, variant.hex_2_mm,
                  variant.minimum_bore_mm, variant.unit_weight_g,
                  variant.competitor_part_number, variant.drawing_number,
                  variant.drawing_revision, variant.source, variant.notes,
                  product.catalog_publication_status,
                  product.technical_data_status,
                  product.supply_availability,
                  CASE WHEN image.assignment_kind = 'override'
                    THEN COALESCE(media.approved_reference,
                                  'media-version:' || media.id)
                    ELSE NULL
                  END AS image_override_reference
           FROM catalog_hose_ends variant
           INNER JOIN catalog_skus product
             ON product.import_id = variant.import_id
            AND product.sku = variant.sku
           LEFT JOIN catalog_product_main_images image
             ON image.import_id = variant.import_id
            AND image.sku = variant.sku
           LEFT JOIN catalog_media_versions media ON media.id = image.media_version_id
           WHERE variant.import_id = ? AND variant.sku = ?
             AND product.product_type = 'hose_end'`,
        )
        .bind(release.source_import_id, sku.trim().toUpperCase())
        .first<HoseEndVariantMaintenanceRow>();
      return row ? toHoseEndVariantRecord(row) : null;
    },

    async findHoseSeries(seriesCode) {
      const release = await findMaintenanceRelease(database);
      if (!release) return null;
      const row = await database
        .prepare(`${hoseSeriesSelect} AND series.series_code = ?`)
        .bind(release.source_import_id, seriesCode.trim().toUpperCase())
        .first<HoseSeriesRow>();
      return row ? toHoseSeriesRecord(row) : null;
    },

    async findHoseVariant(sku) {
      const release = await findMaintenanceRelease(database);
      if (!release) return null;
      const row = await database
        .prepare(
          `SELECT variant.sku, variant.hose_series, variant.dash,
                  variant.nominal_id_in, variant.id_mm, variant.od_mm,
                  variant.working_bar, variant.working_psi, variant.burst_bar,
                  variant.bend_radius_mm, variant.weight_kg_m,
                  variant.skive_requirement, variant.msha_marking,
                  variant.source, variant.notes,
                  product.catalog_publication_status,
                  product.technical_data_status,
                  product.supply_availability,
                  CASE WHEN image.assignment_kind = 'override'
                    THEN COALESCE(media.approved_reference,
                                  'media-version:' || media.id)
                    ELSE NULL
                  END AS image_override_reference
           FROM catalog_hose_variants variant
           INNER JOIN catalog_skus product
             ON product.import_id = variant.import_id
            AND product.sku = variant.sku
           LEFT JOIN catalog_product_main_images image
             ON image.import_id = variant.import_id
            AND image.sku = variant.sku
           LEFT JOIN catalog_media_versions media
             ON media.id = image.media_version_id
           WHERE variant.import_id = ? AND variant.sku = ?
             AND product.product_type = 'hose'`,
        )
        .bind(release.source_import_id, sku.trim().toUpperCase())
        .first<HoseVariantMaintenanceRow>();
      return row ? toHoseVariantRecord(row) : null;
    },

    async findProductIdentity(sku) {
      return findProductIdentityInCatalog(database, sku);
    },

    async listHoseSeries() {
      const release = await findMaintenanceRelease(database);
      if (!release) return [];
      const rows = await database
        .prepare(`${hoseSeriesSelect} ORDER BY series.series_code`)
        .bind(release.source_import_id)
        .all<HoseSeriesRow>();
      return rows.results.map(toHoseSeriesRecord);
    },

    async listHoseEndSeries() {
      const release = await findMaintenanceRelease(database);
      if (!release) return [];
      const rows = await database
        .prepare(`${hoseEndSeriesSelect} ORDER BY series.series_code`)
        .bind(release.source_import_id)
        .all<HoseEndSeriesMaintenanceRow>();
      return rows.results.map(toHoseEndSeriesRecord);
    },

    async saveHoseEndSeries(operation) {
      let draft = await findCurrentDraft(database);
      const active = draft ? null : await findActiveRelease(database);
      if (
        mediaVersionIdFromReference(
          operation.series.representativeImageReference,
        )
      ) {
        const media = await database
          .prepare(`SELECT id FROM catalog_media_versions WHERE id = ?`)
          .bind(
            resolvedMediaVersionId(
              operation.series.representativeImageReference,
            ),
          )
          .first<{ id: string }>();
        if (!media) {
          throw new Error(
            "Uploaded representative image was not found / 未找到已上传的系列代表图",
          );
        }
      }
      const statements = draft
        ? []
        : draftCreationStatements(database, operation, active);
      draft ??= {
        id: operation.draftReleaseId,
        release_number: operation.draftReleaseNumber,
        source_import_id: operation.draftImportId,
        status: "draft",
      };
      if (operation.mode === "edit") {
        const existing = await database
          .prepare(
            `SELECT series_code FROM catalog_hose_end_series
             WHERE import_id = ? AND series_code = ?`,
          )
          .bind(draft.source_import_id, operation.series.seriesCode)
          .first<{ series_code: string }>();
        if (!existing && statements.length === 0) {
          throw new Error(
            "Hose End Series is not present in the current draft / 当前草稿中不存在该压接接头系列",
          );
        }
      }
      await database.batch([
        ...statements,
        ...hoseEndSeriesMutationStatements(database, operation, draft),
      ]);
      return {
        draftReleaseId: draft.id,
        mode: operation.mode === "create" ? "created" : "updated",
        seriesCode: operation.series.seriesCode,
      };
    },

    async saveHoseEndVariant(operation) {
      let draft = await findCurrentDraft(database);
      const active = draft ? null : await findActiveRelease(database);
      if (
        operation.imageOverrideReference &&
        mediaVersionIdFromReference(operation.imageOverrideReference)
      ) {
        const media = await database
          .prepare(`SELECT id FROM catalog_media_versions WHERE id = ?`)
          .bind(resolvedMediaVersionId(operation.imageOverrideReference))
          .first<{ id: string }>();
        if (!media) {
          throw new Error(
            "Uploaded image override was not found / 未找到已上传的子体覆盖图",
          );
        }
      }
      const statements = draft
        ? []
        : draftCreationStatements(database, operation, active);
      draft ??= {
        id: operation.draftReleaseId,
        release_number: operation.draftReleaseNumber,
        source_import_id: operation.draftImportId,
        status: "draft",
      };
      if (operation.mode === "edit") {
        const existing = await database
          .prepare(
            `SELECT sku FROM catalog_skus
             WHERE import_id = ? AND sku = ? AND product_type = 'hose_end'`,
          )
          .bind(draft.source_import_id, operation.variant.sku)
          .first<{ sku: string }>();
        if (!existing && statements.length === 0) {
          throw new Error(
            "Hose End Variant is not present in the current draft / 当前草稿中不存在该压接接头子体",
          );
        }
      }
      await database.batch([
        ...statements,
        ...hoseEndVariantMutationStatements(database, operation, draft),
      ]);
      return {
        draftReleaseId: draft.id,
        mode: operation.mode === "create" ? "created" : "updated",
        sku: operation.variant.sku,
      };
    },

    async saveHoseSeries(operation) {
      let draft = await findCurrentDraft(database);
      const active = draft ? null : await findActiveRelease(database);
      if (
        mediaVersionIdFromReference(
          operation.series.representativeImageReference,
        )
      ) {
        const media = await database
          .prepare(`SELECT id FROM catalog_media_versions WHERE id = ?`)
          .bind(
            resolvedMediaVersionId(
              operation.series.representativeImageReference,
            ),
          )
          .first<{ id: string }>();
        if (!media) {
          throw new Error(
            "Uploaded representative image was not found / 未找到已上传的系列代表图",
          );
        }
      }
      const statements = draft
        ? []
        : draftCreationStatements(database, operation, active);
      draft ??= {
        id: operation.draftReleaseId,
        release_number: operation.draftReleaseNumber,
        source_import_id: operation.draftImportId,
        status: "draft",
      };
      if (operation.mode === "edit") {
        const existing = await database
          .prepare(
            `SELECT series_code FROM catalog_hose_series
             WHERE import_id = ? AND series_code = ?`,
          )
          .bind(draft.source_import_id, operation.series.seriesCode)
          .first<{ series_code: string }>();
        if (!existing && statements.length === 0) {
          throw new Error(
            "Hose Series is not present in the current draft / 当前草稿中不存在该胶管系列",
          );
        }
      }
      await database.batch([
        ...statements,
        ...hoseSeriesMutationStatements(database, operation, draft),
      ]);
      return {
        draftReleaseId: draft.id,
        mode: operation.mode === "create" ? "created" : "updated",
        seriesCode: operation.series.seriesCode,
      };
    },

    async saveHoseVariant(operation) {
      let draft = await findCurrentDraft(database);
      const active = draft ? null : await findActiveRelease(database);
      if (
        operation.imageOverrideReference &&
        mediaVersionIdFromReference(operation.imageOverrideReference)
      ) {
        const media = await database
          .prepare(`SELECT id FROM catalog_media_versions WHERE id = ?`)
          .bind(resolvedMediaVersionId(operation.imageOverrideReference))
          .first<{ id: string }>();
        if (!media) {
          throw new Error(
            "Uploaded image override was not found / 未找到已上传的子体覆盖图",
          );
        }
      }
      const statements = draft
        ? []
        : draftCreationStatements(database, operation, active);
      draft ??= {
        id: operation.draftReleaseId,
        release_number: operation.draftReleaseNumber,
        source_import_id: operation.draftImportId,
        status: "draft",
      };
      if (operation.mode === "edit") {
        const existing = await database
          .prepare(
            `SELECT sku FROM catalog_skus
             WHERE import_id = ? AND sku = ? AND product_type = 'hose'`,
          )
          .bind(draft.source_import_id, operation.variant.sku)
          .first<{ sku: string }>();
        if (!existing && statements.length === 0) {
          throw new Error(
            "Hose Variant is not present in the current draft / 当前草稿中不存在该胶管子体",
          );
        }
      }
      await database.batch([
        ...statements,
        ...hoseVariantMutationStatements(database, operation, draft),
      ]);
      return {
        draftReleaseId: draft.id,
        mode: operation.mode === "create" ? "created" : "updated",
        sku: operation.variant.sku,
      };
    },

    async saveManualComponent(operation) {
      let draft = await findCurrentDraft(database);
      const active = draft ? null : await findActiveRelease(database);
      const imageSourceImportId =
        draft?.source_import_id ?? active?.source_import_id ?? null;
      const imageAffectedSkus = await findImageAffectedSkus(
        database,
        imageSourceImportId,
        operation.replaceSharedImageFrom,
      );
      if (mediaVersionIdFromReference(operation.mainImageReference)) {
        const media = await database
          .prepare(`SELECT id FROM catalog_media_versions WHERE id = ?`)
          .bind(resolvedMediaVersionId(operation.mainImageReference))
          .first<{ id: string }>();
        if (!media)
          throw new Error("Uploaded main-image version was not found");
      }
      const statements = draft
        ? []
        : draftCreationStatements(database, operation, active);
      draft ??= {
        id: operation.draftReleaseId,
        release_number: operation.draftReleaseNumber,
        source_import_id: operation.draftImportId,
        status: "draft",
      };

      if (operation.mode === "edit") {
        const existing = await database
          .prepare(
            `SELECT sku FROM catalog_skus
             WHERE import_id = ? AND sku = ? AND product_type = ?`,
          )
          .bind(
            draft.source_import_id,
            operation.master.sku,
            operation.productType,
          )
          .first<{ sku: string }>();
        if (!existing && statements.length === 0) {
          throw new Error(
            `${operation.productType} SKU ${operation.master.sku} is not present in the current draft`,
          );
        }
      }

      await database.batch([
        ...statements,
        ...componentMutationStatements(
          database,
          operation,
          draft,
          imageAffectedSkus,
        ),
      ]);
      return {
        draftReleaseId: draft.id,
        draftReleaseNumber: draft.release_number,
        mode: operation.mode === "create" ? "created" : "updated",
        imageAffectedSkus:
          operation.replaceSharedImageFrom && imageAffectedSkus.length === 0
            ? [operation.master.sku]
            : imageAffectedSkus,
        productType: operation.productType,
        sku: operation.master.sku,
      };
    },

    async saveManualHose(operation) {
      let draft = await findCurrentDraft(database);
      const active = draft ? null : await findActiveRelease(database);
      const imageSourceImportId =
        draft?.source_import_id ?? active?.source_import_id ?? null;
      const imageAffectedSkus = await findImageAffectedSkus(
        database,
        imageSourceImportId,
        operation.replaceSharedImageFrom,
      );
      if (mediaVersionIdFromReference(operation.mainImageReference)) {
        const media = await database
          .prepare(`SELECT id FROM catalog_media_versions WHERE id = ?`)
          .bind(resolvedMediaVersionId(operation.mainImageReference))
          .first<{ id: string }>();
        if (!media)
          throw new Error("Uploaded main-image version was not found");
      }
      const statements = draft
        ? []
        : draftCreationStatements(database, operation, active);
      draft ??= {
        id: operation.draftReleaseId,
        release_number: operation.draftReleaseNumber,
        source_import_id: operation.draftImportId,
        status: "draft",
      };

      if (operation.mode === "edit") {
        const existing = await database
          .prepare(
            `SELECT sku FROM catalog_skus
             WHERE import_id = ? AND sku = ? AND product_type = 'hose'`,
          )
          .bind(draft.source_import_id, operation.hose.sku)
          .first<{ sku: string }>();
        if (!existing && statements.length === 0) {
          throw new Error(
            `Hose SKU ${operation.hose.sku} is not present in the current draft`,
          );
        }
      }

      await database.batch([
        ...statements,
        ...mutationStatements(database, operation, draft, imageAffectedSkus),
      ]);
      return {
        draftReleaseId: draft.id,
        draftReleaseNumber: draft.release_number,
        mode: operation.mode === "create" ? "created" : "updated",
        imageAffectedSkus:
          operation.replaceSharedImageFrom && imageAffectedSkus.length === 0
            ? [operation.hose.sku]
            : imageAffectedSkus,
        sku: operation.hose.sku,
      };
    },
  };
}
