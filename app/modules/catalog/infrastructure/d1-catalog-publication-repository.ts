import type {
  CatalogPublicationAssemblyState,
  CatalogPublicationDifferences,
  CatalogPublicationFinding,
  CatalogPublicationOperation,
  CatalogPublicationPreview,
  CatalogPublicationReceipt,
  CatalogPublicationRelease,
  CatalogPublicationRepository,
  CatalogPublicationSummary,
} from "../domain/catalog-publication";
import type { SupplyAvailability } from "../domain/catalog-draft-availability";
import type {
  CatalogPublicationStatus,
  CatalogSkuDraft,
  RfqEligibility,
  TechnicalDataStatus,
} from "../domain/catalog-workbook";
import { validateConfiguratorReferenceSnapshot } from "../../configurator-reference/domain/configurator-reference";
import { createD1ConfiguratorReferenceRepository } from "../../configurator-reference/infrastructure/d1-configurator-reference-repository";
import { publicCatalogMainImageUrl } from "../domain/catalog-main-image";

interface DraftReleaseRow {
  created_at: string;
  error_count: number;
  id: string;
  release_number: string;
  source_import_id: string;
  summary_json: string;
  version: number;
  warning_count: number;
}

interface ActiveReleaseRow {
  active_generation: number;
  created_at: string | null;
  id: string | null;
  release_number: string | null;
  source_import_id: string | null;
  version: number | null;
}

interface PersistedCounts {
  adapterCount: number;
  adapterFamilyCount: number;
  costBasisCount: number;
  compatibilityCount: number;
  costBasisPriceCount: number;
  ferruleCount: number;
  hoseEndCount: number;
  hoseSeriesCount: number;
  hoseVariantCount: number;
  quickCouplerCount: number;
  referencePriceCount: number;
  salesOfferCount: number;
  skuCount: number;
}

interface ValidationRow {
  code: string;
  message: string;
  row_number: number;
  severity: "error" | "warning";
  worksheet: string;
}

interface PublicProductRow extends Record<string, unknown> {
  sku: string;
}

interface PublicCatalogProductRow {
  catalog_publication_status: CatalogPublicationStatus;
  hose_series: string | null;
  main_image_approved_reference: string | null;
  main_image_version_id: string | null;
  product_type: CatalogSkuDraft["productType"];
  release_id: string;
  release_number: string;
  rfq_eligibility: RfqEligibility;
  sku: string;
  supply_availability: SupplyAvailability;
  technical_data_status: TechnicalDataStatus;
}

export interface CatalogPublicationPreparationReceipt {
  activeGeneration: number;
  activeReleaseId: string | null;
  assemblyState: CatalogPublicationAssemblyState;
  draftVersion: number;
  preparedAt: string;
  releaseId: string;
}

export interface PublicCatalogProduct {
  canAddToQuote: boolean;
  catalogPublicationStatus: CatalogPublicationStatus;
  hoseSeries: string | null;
  mainImageUrl: string | null;
  productType: CatalogSkuDraft["productType"];
  releaseId: string;
  releaseNumber: string;
  rfqEligibility: RfqEligibility;
  sku: string;
  supplyAvailability: SupplyAvailability;
  technicalDataStatus: TechnicalDataStatus;
}

const countKeys = [
  "adapterCount",
  "adapterFamilyCount",
  "compatibilityCount",
  "costBasisPriceCount",
  "ferruleCount",
  "hoseEndCount",
  "hoseSeriesCount",
  "hoseVariantCount",
  "quickCouplerCount",
  "referencePriceCount",
  "salesOfferCount",
  "skuCount",
] as const satisfies readonly (keyof PersistedCounts)[];

const productDetailTables = [
  { keyColumn: "sku", name: "catalog_hose_variants" },
  { keyColumn: "sku", name: "catalog_hose_ends" },
  { keyColumn: "sku", name: "catalog_ferrules" },
  { keyColumn: "sku", name: "catalog_adapters" },
  { keyColumn: "sku", name: "catalog_quick_couplers" },
] as const;

const inheritedProductDetailTables = [
  {
    seriesKey: "series_code",
    seriesTable: "catalog_hose_series",
    variantSeriesKey: "hose_series",
    variantTable: "catalog_hose_variants",
  },
  {
    seriesKey: "series_code",
    seriesTable: "catalog_hose_end_series",
    variantSeriesKey: "fitting_series",
    variantTable: "catalog_hose_ends",
  },
] as const;

const relationshipTables = [
  {
    keyColumn: "series_code",
    label: "Hose Series",
    name: "catalog_hose_series",
  },
  {
    keyColumn: "series_code",
    label: "Hose End Series",
    name: "catalog_hose_end_series",
  },
  {
    keyColumn: "adapter_family_id",
    label: "Adapter Family",
    name: "catalog_adapter_families",
  },
  {
    keyColumn: "compatibility_id",
    label: "Compatibility",
    name: "catalog_compatibilities",
  },
] as const;

function releaseFromActive(
  row: ActiveReleaseRow,
): CatalogPublicationRelease | null {
  if (
    !row.id ||
    !row.release_number ||
    !row.source_import_id ||
    !row.created_at ||
    row.version === null
  ) {
    return null;
  }
  return {
    createdAt: row.created_at,
    id: row.id,
    releaseNumber: row.release_number,
    sourceImportId: row.source_import_id,
    version: row.version,
  };
}

function releaseFromDraft(row: DraftReleaseRow): CatalogPublicationRelease {
  return {
    createdAt: row.created_at,
    id: row.id,
    releaseNumber: row.release_number,
    sourceImportId: row.source_import_id,
    version: row.version,
  };
}

function parseExpectedCounts(summaryJson: string): PersistedCounts | null {
  try {
    const value: unknown = JSON.parse(summaryJson);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const record = value as Record<string, unknown>;
    const counts = {} as PersistedCounts;
    for (const key of countKeys) {
      const count = record[key];
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        return null;
      }
      counts[key] = count;
    }
    return counts;
  } catch {
    return null;
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalValue)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "id" && key !== "import_id")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

async function publicProductFingerprints(
  database: D1Database,
  importId: string | null,
) {
  const fingerprints = new Map<string, Record<string, unknown>>();
  if (!importId) return new Map<string, string>();

  const products = await database
    .prepare(
      `SELECT * FROM catalog_skus
       WHERE import_id = ? AND catalog_publication_status = 'Published'
       ORDER BY sku`,
    )
    .bind(importId)
    .all<PublicProductRow>();
  for (const product of products.results) {
    fingerprints.set(product.sku, { product: canonicalValue(product) });
  }

  for (const table of productDetailTables) {
    const rows = await database
      .prepare(`SELECT * FROM ${table.name} WHERE import_id = ?`)
      .bind(importId)
      .all<Record<string, unknown>>();
    for (const row of rows.results) {
      const sku = row[table.keyColumn];
      if (typeof sku !== "string" || !fingerprints.has(sku)) continue;
      const product = fingerprints.get(sku);
      if (!product) continue;
      const current = product[table.name];
      const normalized = canonicalValue(row);
      product[table.name] = Array.isArray(current)
        ? [...current, normalized]
        : [normalized];
    }
  }

  for (const table of inheritedProductDetailTables) {
    const rows = await database
      .prepare(
        `SELECT variant.sku AS inherited_sku, series.*
         FROM ${table.variantTable} variant
         INNER JOIN ${table.seriesTable} series
           ON series.import_id = variant.import_id
          AND series.${table.seriesKey} = variant.${table.variantSeriesKey}
         WHERE variant.import_id = ?`,
      )
      .bind(importId)
      .all<Record<string, unknown>>();
    for (const row of rows.results) {
      const sku = row.inherited_sku;
      if (typeof sku !== "string") continue;
      const product = fingerprints.get(sku);
      if (!product) continue;
      const series = Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "inherited_sku"),
      );
      product[table.seriesTable] = canonicalValue(series);
    }
  }

  return new Map(
    [...fingerprints].map(([sku, value]) => [
      sku,
      JSON.stringify(canonicalValue(value)),
    ]),
  );
}

async function imageFingerprints(
  database: D1Database,
  importId: string | null,
) {
  const fingerprints = new Map<string, string>();
  if (!importId) return fingerprints;
  const rows = await database
    .prepare(
      `SELECT product.sku,
              COALESCE(image.media_version_id,
                       hose_series.representative_media_version_id,
                       hose_end_series.representative_media_version_id)
                AS media_version_id
       FROM catalog_skus product
       LEFT JOIN catalog_product_main_images image
         ON image.import_id = product.import_id
        AND image.sku = product.sku
        AND image.assignment_kind = 'override'
       LEFT JOIN catalog_hose_variants hose
         ON hose.import_id = product.import_id AND hose.sku = product.sku
       LEFT JOIN catalog_hose_series hose_series
         ON hose_series.import_id = hose.import_id
        AND hose_series.series_code = hose.hose_series
       LEFT JOIN catalog_hose_ends hose_end
         ON hose_end.import_id = product.import_id
        AND hose_end.sku = product.sku
       LEFT JOIN catalog_hose_end_series hose_end_series
         ON hose_end_series.import_id = hose_end.import_id
        AND hose_end_series.series_code = hose_end.fitting_series
       WHERE product.import_id = ?
       ORDER BY product.sku`,
    )
    .bind(importId)
    .all<{ media_version_id: string | null; sku: string }>();
  for (const row of rows.results) {
    fingerprints.set(row.sku, row.media_version_id ?? "");
  }
  return fingerprints;
}

async function priceFingerprints(
  database: D1Database,
  importId: string | null,
) {
  const fingerprints = new Map<string, string>();
  if (!importId) return fingerprints;
  const rows = await database
    .prepare(
      `SELECT product.sku,
              COALESCE(rule.sales_unit, offer.sales_unit) AS sales_unit,
              COALESCE(rule.moq, offer.moq) AS moq,
              COALESCE(rule.lead_time_days, offer.lead_time_days) AS lead_time_days,
              COALESCE(rule.country_of_origin, offer.country_of_origin) AS country_of_origin,
              CASE WHEN rule.id IS NOT NULL THEN rule.hs_code ELSE offer.hs_code END AS hs_code,
              CASE WHEN rule.id IS NOT NULL THEN rule.notes ELSE offer.notes END AS notes,
              COALESCE(rule.quantity_input_mode, offer.quantity_input_mode) AS quantity_input_mode,
              CASE WHEN rule.id IS NOT NULL THEN rule.minimum_length_per_piece_ft ELSE offer.minimum_length_per_piece_ft END AS minimum_length_per_piece_ft,
              CASE WHEN rule.id IS NOT NULL THEN rule.length_increment_ft ELSE offer.length_increment_ft END AS length_increment_ft,
              CASE WHEN rule.id IS NOT NULL THEN rule.preset_length_1_ft ELSE offer.preset_length_1_ft END AS preset_length_1_ft,
              CASE WHEN rule.id IS NOT NULL THEN rule.preset_length_2_ft ELSE offer.preset_length_2_ft END AS preset_length_2_ft,
              CASE WHEN rule.id IS NOT NULL THEN rule.preset_length_3_ft ELSE offer.preset_length_3_ft END AS preset_length_3_ft,
              CASE WHEN rule.id IS NOT NULL THEN rule.continuous_length_confirmation ELSE offer.continuous_length_confirmation END AS continuous_length_confirmation,
              CASE WHEN exact.id IS NOT NULL THEN exact.currency ELSE offer.currency END AS currency,
              CASE WHEN exact.id IS NOT NULL THEN exact.reference_price_usd ELSE offer.reference_price_usd END AS reference_price_usd,
              CASE WHEN exact.id IS NOT NULL THEN exact.package_length_ft ELSE offer.package_length_ft END AS package_length_ft,
              CASE WHEN exact.id IS NOT NULL THEN exact.units_per_sales_pack ELSE offer.units_per_sales_pack END AS units_per_sales_pack,
              CASE WHEN exact.id IS NOT NULL THEN exact.net_unit_weight_kg ELSE offer.net_unit_weight_kg END AS net_unit_weight_kg,
              CASE WHEN exact.id IS NOT NULL THEN exact.inner_pack_qty ELSE offer.inner_pack_qty END AS inner_pack_qty,
              CASE WHEN exact.id IS NOT NULL THEN exact.master_carton_qty ELSE offer.master_carton_qty END AS master_carton_qty,
              CASE WHEN exact.id IS NOT NULL THEN exact.carton_gross_weight_kg ELSE offer.carton_gross_weight_kg END AS carton_gross_weight_kg,
              CASE WHEN exact.id IS NOT NULL THEN exact.carton_l_cm ELSE offer.carton_l_cm END AS carton_l_cm,
              CASE WHEN exact.id IS NOT NULL THEN exact.carton_w_cm ELSE offer.carton_w_cm END AS carton_w_cm,
              CASE WHEN exact.id IS NOT NULL THEN exact.carton_h_cm ELSE offer.carton_h_cm END AS carton_h_cm,
              CASE WHEN exact.id IS NOT NULL THEN exact.packing_basis ELSE offer.packing_basis END AS packing_basis
       FROM catalog_skus product
       LEFT JOIN catalog_sales_offers offer
         ON offer.import_id = product.import_id AND offer.base_sku = product.sku
       LEFT JOIN catalog_hose_variants hose
         ON hose.import_id = product.import_id AND hose.sku = product.sku
       LEFT JOIN catalog_hose_ends hose_end
         ON hose_end.import_id = product.import_id AND hose_end.sku = product.sku
       LEFT JOIN catalog_ferrules ferrule
         ON ferrule.import_id = product.import_id AND ferrule.sku = product.sku
       LEFT JOIN catalog_adapters adapter
         ON adapter.import_id = product.import_id AND adapter.sku = product.sku
       LEFT JOIN catalog_quick_couplers coupler
         ON coupler.import_id = product.import_id AND coupler.sku = product.sku
       LEFT JOIN catalog_series_commercial_rules rule
         ON rule.import_id = product.import_id
        AND rule.product_type = product.product_type
        AND rule.series_code = CASE product.product_type
          WHEN 'hose' THEN hose.hose_series
          WHEN 'hose_end' THEN hose_end.fitting_series
          WHEN 'ferrule' THEN ferrule.ferrule_series
          WHEN 'adapter' THEN adapter.adapter_family_id
          WHEN 'quick_coupler' THEN coupler.coupler_series
        END
       LEFT JOIN catalog_sku_price_packaging exact
         ON exact.import_id = product.import_id AND exact.sku = product.sku
       WHERE product.import_id = ? AND product.catalog_publication_status = 'Published'
       ORDER BY product.sku`,
    )
    .bind(importId)
    .all<Record<string, unknown>>();
  for (const row of rows.results) {
    const sku = row.sku;
    if (typeof sku === "string") {
      fingerprints.set(sku, JSON.stringify(canonicalValue(row)));
    }
  }
  return fingerprints;
}

async function effectiveDerivedReleaseId(
  database: D1Database,
  releaseId: string,
) {
  const row = await database
    .prepare(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM catalog_derived_assembly_series
         WHERE release_id = release.id
       ) THEN release.id ELSE impact.baseline_release_id END AS derived_release_id
       FROM catalog_releases release
       LEFT JOIN catalog_assembly_impact_analyses impact
         ON impact.release_id = release.id
       WHERE release.id = ?`,
    )
    .bind(releaseId)
    .first<{ derived_release_id: string | null }>();
  return row?.derived_release_id ?? releaseId;
}

async function derivedCombinationFingerprints(
  database: D1Database,
  releaseId: string | null,
) {
  const fingerprints = new Map<string, string>();
  if (!releaseId) return fingerprints;
  const effectiveReleaseId = await effectiveDerivedReleaseId(
    database,
    releaseId,
  );
  const rows = await database
    .prepare(
      `SELECT hose_sku, end_a_compatibility_id, end_b_compatibility_id,
              end_a_hose_end_sku, end_a_ferrule_sku,
              end_b_hose_end_sku, end_b_ferrule_sku,
              end_a_relationship_fingerprint,
              end_b_relationship_fingerprint,
              combination_fingerprint
       FROM catalog_derived_assembly_combinations
       WHERE release_id = ?
       ORDER BY hose_sku, end_a_compatibility_id, end_b_compatibility_id`,
    )
    .bind(effectiveReleaseId)
    .all<Record<string, unknown>>();
  for (const row of rows.results) {
    const key = `${String(row.hose_sku)} / ${String(row.end_a_compatibility_id)} → ${String(row.end_b_compatibility_id)}`;
    fingerprints.set(key, JSON.stringify(canonicalValue(row)));
  }
  return fingerprints;
}

async function publicationAssemblyState(
  database: D1Database,
  releaseId: string,
): Promise<CatalogPublicationAssemblyState> {
  const effectiveReleaseId = await effectiveDerivedReleaseId(
    database,
    releaseId,
  );
  const row = await database
    .prepare(
      `SELECT impact.input_fingerprint,
              (SELECT COUNT(*) FROM catalog_derived_assembly_series
               WHERE release_id = ?) AS derived_series_count,
              (SELECT COUNT(*) FROM catalog_derived_assembly_combinations
               WHERE release_id = ?) AS derived_combination_count,
              (SELECT group_concat(generation_id, ',') FROM (
                 SELECT DISTINCT generation_id
                 FROM catalog_derived_assembly_series
                 WHERE release_id = ? ORDER BY generation_id
               )) AS generation_id
       FROM catalog_assembly_impact_analyses impact
       WHERE impact.release_id = ?`,
    )
    .bind(effectiveReleaseId, effectiveReleaseId, effectiveReleaseId, releaseId)
    .first<{
      derived_combination_count: number;
      derived_series_count: number;
      generation_id: string | null;
      input_fingerprint: string;
    }>();
  return {
    derivedCombinationCount: row?.derived_combination_count ?? 0,
    derivedSeriesCount: row?.derived_series_count ?? 0,
    generationId: row?.generation_id ?? null,
    inputFingerprint: row?.input_fingerprint ?? "missing",
  };
}

async function relationshipFingerprints(
  database: D1Database,
  importId: string | null,
) {
  const fingerprints = new Map<string, string>();
  if (!importId) return fingerprints;

  for (const table of relationshipTables) {
    const rows = await database
      .prepare(`SELECT * FROM ${table.name} WHERE import_id = ?`)
      .bind(importId)
      .all<Record<string, unknown>>();
    for (const row of rows.results) {
      const key = row[table.keyColumn];
      if (typeof key !== "string") continue;
      fingerprints.set(
        `${table.label} ${key}`,
        JSON.stringify(canonicalValue(row)),
      );
    }
  }

  return fingerprints;
}

function publicProduct(row: PublicCatalogProductRow): PublicCatalogProduct {
  return {
    canAddToQuote:
      row.catalog_publication_status === "Published" &&
      row.rfq_eligibility === "Eligible" &&
      row.supply_availability === "available_for_quote",
    catalogPublicationStatus: row.catalog_publication_status,
    hoseSeries: row.hose_series,
    mainImageUrl: publicCatalogMainImageUrl(
      row.main_image_version_id,
      row.main_image_approved_reference,
    ),
    productType: row.product_type,
    releaseId: row.release_id,
    releaseNumber: row.release_number,
    rfqEligibility: row.rfq_eligibility,
    sku: row.sku,
    supplyAvailability: row.supply_availability,
    technicalDataStatus: row.technical_data_status,
  };
}

async function persistedCounts(database: D1Database, importId: string) {
  return database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM catalog_skus WHERE import_id = ?) AS skuCount,
        (SELECT COUNT(*) FROM catalog_hose_series WHERE import_id = ?) AS hoseSeriesCount,
        (SELECT COUNT(*) FROM catalog_hose_variants WHERE import_id = ?) AS hoseVariantCount,
        (SELECT COUNT(*) FROM catalog_hose_ends WHERE import_id = ?) AS hoseEndCount,
        (SELECT COUNT(*) FROM catalog_ferrules WHERE import_id = ?) AS ferruleCount,
        (SELECT COUNT(*) FROM catalog_compatibilities WHERE import_id = ?) AS compatibilityCount,
        (SELECT COUNT(*) FROM catalog_adapter_families WHERE import_id = ?) AS adapterFamilyCount,
        (SELECT COUNT(*) FROM catalog_adapters WHERE import_id = ?) AS adapterCount,
        (SELECT COUNT(*) FROM catalog_quick_couplers WHERE import_id = ?) AS quickCouplerCount,
        (SELECT COUNT(*) FROM catalog_sales_offers WHERE import_id = ?) AS salesOfferCount,
        (SELECT COUNT(*) FROM catalog_sales_offers WHERE import_id = ? AND reference_price_usd IS NOT NULL) AS referencePriceCount,
        (SELECT COUNT(*) FROM catalog_cost_bases WHERE import_id = ?) AS costBasisCount,
        (SELECT COUNT(*) FROM catalog_cost_bases WHERE import_id = ? AND (factory_unit_price IS NOT NULL OR tier_price IS NOT NULL)) AS costBasisPriceCount`,
    )
    .bind(...Array.from({ length: 13 }, () => importId))
    .first<PersistedCounts>();
}

function diffFingerprints(
  draft: Map<string, string>,
  active: Map<string, string>,
): CatalogPublicationDifferences {
  const additions = [...draft.keys()].filter((sku) => !active.has(sku));
  const removals = [...active.keys()].filter((sku) => !draft.has(sku));
  const changes = [...draft.keys()].filter(
    (sku) => active.has(sku) && active.get(sku) !== draft.get(sku),
  );
  return { additions, changes, removals };
}

function validationFinding(row: ValidationRow): CatalogPublicationFinding {
  const location = row.row_number > 0 ? ` row ${row.row_number}` : "";
  return {
    code: row.code,
    message: `${row.worksheet}${location}: ${row.message}`,
  };
}

export function createD1CatalogPublicationRepository(
  database: D1Database,
): CatalogPublicationRepository & {
  findActiveRelease(): Promise<CatalogPublicationRelease | null>;
  findActivePublicProduct(sku: string): Promise<PublicCatalogProduct | null>;
  findHistoricalPublicProduct(
    releaseId: string,
    sku: string,
  ): Promise<PublicCatalogProduct | null>;
  findPublicationPreparation(
    requestCorrelationId: string,
  ): Promise<CatalogPublicationPreparationReceipt | null>;
  recordPublicationPreparation(input: {
    actorId: string;
    ipAddress: string;
    preview: CatalogPublicationPreview;
    releaseId: string;
    requestCorrelationId: string;
  }): Promise<void>;
  synchronizeDraftSalesOfferLifecycle(input: {
    actorId: string;
    ipAddress: string;
    releaseId: string;
    requestCorrelationId: string;
  }): Promise<number>;
} {
  async function findActiveRow() {
    return database
      .prepare(
        `SELECT catalog_active_release.version AS active_generation,
                catalog_releases.id, catalog_releases.release_number,
                catalog_releases.source_import_id, catalog_releases.version,
                catalog_releases.created_at
         FROM catalog_active_release
         LEFT JOIN catalog_releases
           ON catalog_releases.id = catalog_active_release.release_id
         WHERE catalog_active_release.singleton = 1`,
      )
      .first<ActiveReleaseRow>();
  }

  return {
    async findActiveRelease() {
      const row = await findActiveRow();
      return row ? releaseFromActive(row) : null;
    },

    async findActivePublicProduct(sku) {
      const row = await database
        .prepare(
          `SELECT catalog_releases.id AS release_id,
                  catalog_releases.release_number,
                  catalog_skus.sku, catalog_skus.product_type,
                  catalog_skus.hose_series,
                  catalog_skus.catalog_publication_status,
                  catalog_skus.rfq_eligibility,
                  catalog_skus.technical_data_status,
                  catalog_skus.supply_availability,
                  media.id AS main_image_version_id,
                  media.approved_reference AS main_image_approved_reference
           FROM catalog_active_release
           INNER JOIN catalog_releases
             ON catalog_releases.id = catalog_active_release.release_id
           INNER JOIN catalog_skus
             ON catalog_skus.import_id = catalog_releases.source_import_id
           LEFT JOIN catalog_product_main_images image
             ON image.import_id = catalog_skus.import_id
            AND image.sku = catalog_skus.sku
            AND image.assignment_kind = 'override'
           LEFT JOIN catalog_hose_variants hose
             ON hose.import_id = catalog_skus.import_id
            AND hose.sku = catalog_skus.sku
           LEFT JOIN catalog_hose_series hose_series
             ON hose_series.import_id = hose.import_id
            AND hose_series.series_code = hose.hose_series
           LEFT JOIN catalog_hose_ends hose_end
             ON hose_end.import_id = catalog_skus.import_id
            AND hose_end.sku = catalog_skus.sku
           LEFT JOIN catalog_hose_end_series hose_end_series
             ON hose_end_series.import_id = hose_end.import_id
            AND hose_end_series.series_code = hose_end.fitting_series
           LEFT JOIN catalog_media_versions media
             ON media.id = COALESCE(
               image.media_version_id,
               hose_series.representative_media_version_id,
               hose_end_series.representative_media_version_id
             )
           WHERE catalog_active_release.singleton = 1
             AND catalog_releases.status = 'published'
             AND catalog_skus.catalog_publication_status = 'Published'
             AND catalog_skus.sku = ?`,
        )
        .bind(sku)
        .first<PublicCatalogProductRow>();
      return row ? publicProduct(row) : null;
    },

    async findHistoricalPublicProduct(releaseId, sku) {
      const row = await database
        .prepare(
          `SELECT catalog_releases.id AS release_id,
                  catalog_releases.release_number,
                  catalog_skus.sku, catalog_skus.product_type,
                  catalog_skus.hose_series,
                  catalog_skus.catalog_publication_status,
                  catalog_skus.rfq_eligibility,
                  catalog_skus.technical_data_status,
                  catalog_skus.supply_availability,
                  media.id AS main_image_version_id,
                  media.approved_reference AS main_image_approved_reference
           FROM catalog_releases
           INNER JOIN catalog_skus
             ON catalog_skus.import_id = catalog_releases.source_import_id
           LEFT JOIN catalog_product_main_images image
             ON image.import_id = catalog_skus.import_id
            AND image.sku = catalog_skus.sku
            AND image.assignment_kind = 'override'
           LEFT JOIN catalog_hose_variants hose
             ON hose.import_id = catalog_skus.import_id
            AND hose.sku = catalog_skus.sku
           LEFT JOIN catalog_hose_series hose_series
             ON hose_series.import_id = hose.import_id
            AND hose_series.series_code = hose.hose_series
           LEFT JOIN catalog_hose_ends hose_end
             ON hose_end.import_id = catalog_skus.import_id
            AND hose_end.sku = catalog_skus.sku
           LEFT JOIN catalog_hose_end_series hose_end_series
             ON hose_end_series.import_id = hose_end.import_id
            AND hose_end_series.series_code = hose_end.fitting_series
           LEFT JOIN catalog_media_versions media
             ON media.id = COALESCE(
               image.media_version_id,
               hose_series.representative_media_version_id,
               hose_end_series.representative_media_version_id
             )
           WHERE catalog_releases.id = ?
             AND catalog_releases.status IN ('published', 'superseded')
             AND catalog_skus.catalog_publication_status = 'Published'
             AND catalog_skus.sku = ?`,
        )
        .bind(releaseId, sku)
        .first<PublicCatalogProductRow>();
      return row ? publicProduct(row) : null;
    },

    async findPublicationReceipt(requestCorrelationId) {
      const row = await database
        .prepare(
          `SELECT release_id, published_at, summary_json
           FROM catalog_release_publications
           WHERE request_correlation_id = ?`,
        )
        .bind(requestCorrelationId)
        .first<{
          published_at: string;
          release_id: string;
          summary_json: string | null;
        }>();
      if (!row) return null;
      let summary: CatalogPublicationSummary = {
        additionCount: 0,
        changeCount: 0,
        deactivationCount: 0,
        warningCount: 0,
      };
      try {
        if (row.summary_json) {
          summary = JSON.parse(row.summary_json) as CatalogPublicationSummary;
        }
      } catch {
        // Legacy receipts predate the summary column and intentionally retain
        // a zero summary rather than making a completed publication retry fail.
      }
      return {
        publishedAt: row.published_at,
        releaseId: row.release_id,
        summary,
      } satisfies CatalogPublicationReceipt;
    },

    async findPublicationPreparation(requestCorrelationId: string) {
      const row = await database
        .prepare(
          `SELECT entity_id, payload_json, occurred_at
           FROM admin_audit_events
           WHERE id = ?
             AND event_type = 'catalog_release.publication_prepared'`,
        )
        .bind(`catalog-release-prepared:${requestCorrelationId}`)
        .first<{
          entity_id: string;
          occurred_at: string;
          payload_json: string;
        }>();
      if (!row) return null;
      const payload = JSON.parse(row.payload_json) as {
        activeGeneration: number;
        activeReleaseId: string | null;
        assemblyState: CatalogPublicationAssemblyState;
        draftVersion: number;
      };
      return {
        ...payload,
        preparedAt: row.occurred_at,
        releaseId: row.entity_id,
      } satisfies CatalogPublicationPreparationReceipt;
    },

    async recordPublicationPreparation(input: {
      actorId: string;
      ipAddress: string;
      preview: CatalogPublicationPreview;
      releaseId: string;
      requestCorrelationId: string;
    }) {
      const occurredAt = new Date().toISOString();
      await database
        .prepare(
          `INSERT OR IGNORE INTO admin_audit_events (
             id, event_type, entity_type, entity_id,
             actor_id, payload_json, occurred_at
           ) VALUES (?, 'catalog_release.publication_prepared',
                     'catalog_release', ?, ?, ?, ?)`,
        )
        .bind(
          `catalog-release-prepared:${input.requestCorrelationId}`,
          input.releaseId,
          input.actorId,
          JSON.stringify({
            activeGeneration: input.preview.activeGeneration,
            activeReleaseId: input.preview.activeRelease?.id ?? null,
            after: {
              activeGeneration: input.preview.activeGeneration,
              activeReleaseId: input.preview.activeRelease?.id ?? null,
              assemblyState: input.preview.assemblyState,
              draftVersion: input.preview.draftRelease.version,
              prepared: true,
            },
            assemblyState: input.preview.assemblyState,
            before: { prepared: false },
            differences: {
              affectedSeries: input.preview.affectedSeries,
              derivedCombinations: input.preview.derivedCombinations,
              images: input.preview.images,
              prices: input.preview.prices,
              products: input.preview.products,
              relationships: input.preview.relationships,
            },
            draftVersion: input.preview.draftRelease.version,
            ipAddress: input.ipAddress,
            requestCorrelationId: input.requestCorrelationId,
          }),
          occurredAt,
        )
        .run();
    },

    async synchronizeDraftSalesOfferLifecycle(input: {
      actorId: string;
      ipAddress: string;
      releaseId: string;
      requestCorrelationId: string;
    }) {
      const changes = await database
        .prepare(
          `SELECT offer.base_sku,
                  offer.catalog_publication_status AS before_publication_status,
                  product.catalog_publication_status AS after_publication_status,
                  offer.rfq_eligibility AS before_rfq_eligibility,
                  product.rfq_eligibility AS after_rfq_eligibility,
                  offer.technical_data_status AS before_technical_data_status,
                  product.technical_data_status AS after_technical_data_status
           FROM catalog_sales_offers offer
           INNER JOIN catalog_releases release
             ON release.source_import_id = offer.import_id
            AND release.id = ? AND release.status = 'draft'
           INNER JOIN catalog_skus product
             ON product.import_id = offer.import_id
            AND product.sku = offer.base_sku
           WHERE product.catalog_publication_status <> offer.catalog_publication_status
              OR product.rfq_eligibility <> offer.rfq_eligibility
              OR product.technical_data_status <> offer.technical_data_status
           ORDER BY offer.base_sku`,
        )
        .bind(input.releaseId)
        .all<Record<string, string>>();
      if (changes.results.length === 0) return 0;

      const auditEventId = `catalog-sales-offer-lifecycle-synchronized:${input.requestCorrelationId}`;
      const occurredAt = new Date().toISOString();
      await database.batch([
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
             WHERE offer.import_id = (
               SELECT source_import_id FROM catalog_releases
               WHERE id = ? AND status = 'draft'
             )
               AND EXISTS (
                 SELECT 1 FROM catalog_skus product
                 WHERE product.import_id = offer.import_id
                   AND product.sku = offer.base_sku
                   AND (
                     product.catalog_publication_status <> offer.catalog_publication_status
                     OR product.rfq_eligibility <> offer.rfq_eligibility
                     OR product.technical_data_status <> offer.technical_data_status
                   )
          )`,
          )
          .bind(input.releaseId),
        database
          .prepare(
            `INSERT OR IGNORE INTO admin_audit_events (
               id, event_type, entity_type, entity_id,
               actor_id, payload_json, occurred_at
             ) VALUES (?, 'catalog_release.sales_offer_lifecycle_synchronized',
                       'catalog_release', ?, ?, ?, ?)`,
          )
          .bind(
            auditEventId,
            input.releaseId,
            input.actorId,
            JSON.stringify({
              affectedCount: changes.results.length,
              changes: changes.results,
              ipAddress: input.ipAddress,
              requestCorrelationId: input.requestCorrelationId,
            }),
            occurredAt,
          ),
      ]);
      return changes.results.length;
    },

    async findPublicationPreview(releaseId) {
      const releaseFilter = releaseId ? "AND catalog_releases.id = ?" : "";
      const statement = database.prepare(
        `SELECT catalog_releases.id, catalog_releases.release_number,
                catalog_releases.source_import_id, catalog_releases.version,
                catalog_releases.created_at, catalog_imports.summary_json,
                catalog_imports.error_count, catalog_imports.warning_count
         FROM catalog_releases
         INNER JOIN catalog_imports
           ON catalog_imports.id = catalog_releases.source_import_id
         WHERE catalog_releases.status = 'draft'
           AND catalog_imports.kind = 'workbook'
           AND catalog_imports.status = 'completed'
           AND (
             (SELECT release_id FROM catalog_active_release WHERE singleton = 1) IS NULL
             OR catalog_releases.created_at > COALESCE(
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
           ${releaseFilter}
         ORDER BY catalog_releases.created_at DESC, catalog_releases.id DESC
         LIMIT 1`,
      );
      const draft = await (
        releaseId ? statement.bind(releaseId) : statement
      ).first<DraftReleaseRow>();
      if (!draft) return null;

      const activeRow = await findActiveRow();
      if (!activeRow)
        throw new Error("Active Catalog Release pointer is missing");
      const activeRelease = releaseFromActive(activeRow);
      const validations = await database
        .prepare(
          `SELECT worksheet, row_number, severity, code, message
           FROM catalog_import_validation_results
           WHERE import_id = ? ORDER BY severity, worksheet, row_number, code`,
        )
        .bind(draft.source_import_id)
        .all<ValidationRow>();
      const warnings = validations.results
        .filter((row) => row.severity === "warning")
        .map(validationFinding);
      const blockers = validations.results
        .filter((row) => row.severity === "error")
        .map(validationFinding);

      if (draft.error_count > 0 && blockers.length === 0) {
        blockers.push({
          code: "import_error_count",
          message: `The source import records ${draft.error_count} errors.`,
        });
      }
      const expected = parseExpectedCounts(draft.summary_json);
      const actual = await persistedCounts(database, draft.source_import_id);
      if (!expected || !actual) {
        blockers.push({
          code: "invalid_import_summary",
          message: "The persisted import summary cannot be revalidated.",
        });
      } else {
        for (const key of countKeys) {
          if (actual[key] !== expected[key]) {
            blockers.push({
              code: `count_mismatch_${key}`,
              message: `${key} expected ${expected[key]} but found ${actual[key]}.`,
            });
          }
        }
        if (actual.costBasisCount !== actual.salesOfferCount) {
          blockers.push({
            code: "cost_basis_row_mismatch",
            message: `Every Sales Offer must retain one private Cost Basis row; found ${actual.costBasisCount} for ${actual.salesOfferCount} offers.`,
          });
        }
        if (actual.skuCount === 0) {
          blockers.push({
            code: "empty_catalog_release",
            message: "A Catalog Release must contain at least one SKU.",
          });
        }
      }

      const invalidState = await database
        .prepare(
          `SELECT COUNT(*) AS count FROM catalog_skus
           WHERE import_id = ? AND (
             catalog_publication_status NOT IN ('Draft', 'Published', 'Archived')
             OR rfq_eligibility NOT IN ('Eligible', 'Manual Quote Only', 'Blocked')
             OR technical_data_status NOT IN ('Complete', 'Inherited', 'Pending')
             OR supply_availability NOT IN ('available_for_quote', 'temporarily_unavailable', 'discontinued')
           )`,
        )
        .bind(draft.source_import_id)
        .first<{ count: number }>();
      if ((invalidState?.count ?? 0) > 0) {
        blockers.push({
          code: "invalid_catalog_state",
          message: `${invalidState?.count} SKUs contain an invalid publication, RFQ, technical, or supply state.`,
        });
      }

      const missingSeriesReferences = await database
        .prepare(
          `SELECT product.sku
           FROM catalog_skus product
           LEFT JOIN catalog_hose_variants hose
             ON hose.import_id = product.import_id AND hose.sku = product.sku
           LEFT JOIN catalog_hose_series hose_series
             ON hose_series.import_id = hose.import_id
            AND hose_series.series_code = hose.hose_series
           LEFT JOIN catalog_hose_ends hose_end
             ON hose_end.import_id = product.import_id AND hose_end.sku = product.sku
           LEFT JOIN catalog_hose_end_series hose_end_series
             ON hose_end_series.import_id = hose_end.import_id
            AND hose_end_series.series_code = hose_end.fitting_series
           WHERE product.import_id = ?
             AND product.catalog_publication_status = 'Published'
             AND (
               (product.product_type = 'hose' AND hose_series.id IS NULL)
               OR
               (product.product_type = 'hose_end' AND hose_end_series.id IS NULL)
             )
           ORDER BY product.sku`,
        )
        .bind(draft.source_import_id)
        .all<{ sku: string }>();
      if (missingSeriesReferences.results.length > 0) {
        blockers.push({
          code: "missing_series_reference",
          message: `${missingSeriesReferences.results.length} publishable variants do not resolve a valid series: ${missingSeriesReferences.results
            .slice(0, 8)
            .map((row) => row.sku)
            .join(
              ", ",
            )}. / ${missingSeriesReferences.results.length} 个待发布子体无法解析有效系列。`,
        });
      }

      const invalidCommercialRows = await database
        .prepare(
          `SELECT product.sku,
                  CASE WHEN exact.id IS NOT NULL
                    THEN exact.sales_sku ELSE offer.sales_sku END AS sales_sku,
                  CASE WHEN exact.id IS NOT NULL
                    THEN exact.currency ELSE offer.currency END AS currency,
                  CASE WHEN exact.id IS NOT NULL
                    THEN exact.reference_price_usd ELSE offer.reference_price_usd
                  END AS reference_price_usd
           FROM catalog_skus product
           LEFT JOIN catalog_sku_price_packaging exact
             ON exact.import_id = product.import_id AND exact.sku = product.sku
           LEFT JOIN catalog_sales_offers offer
             ON offer.import_id = product.import_id AND offer.base_sku = product.sku
           WHERE product.import_id = ?
             AND product.catalog_publication_status = 'Published'
           ORDER BY product.sku`,
        )
        .bind(draft.source_import_id)
        .all<{
          currency: string | null;
          reference_price_usd: number | null;
          sales_sku: string | null;
          sku: string;
        }>();
      const invalidSalesSkus = invalidCommercialRows.results.filter(
        (row) => row.sales_sku !== row.sku,
      );
      if (invalidSalesSkus.length > 0) {
        blockers.push({
          code: "invalid_sales_sku",
          message: `${invalidSalesSkus.length} publishable SKUs do not have the generated Sales SKU: ${invalidSalesSkus
            .slice(0, 8)
            .map((row) => row.sku)
            .join(
              ", ",
            )}. / ${invalidSalesSkus.length} 个待发布 SKU 缺少与产品 SKU 一致的自动生成销售 SKU。`,
        });
      }
      const invalidCurrencies = invalidCommercialRows.results.filter(
        (row) => row.currency !== "USD",
      );
      if (invalidCurrencies.length > 0) {
        blockers.push({
          code: "invalid_retail_currency",
          message: `${invalidCurrencies.length} publishable SKUs do not use USD retail pricing: ${invalidCurrencies
            .slice(0, 8)
            .map((row) => row.sku)
            .join(
              ", ",
            )}. / ${invalidCurrencies.length} 个待发布 SKU 的零售价格币种不是 USD。`,
        });
      }
      const missingReferencePrices = invalidCommercialRows.results.filter(
        (row) =>
          row.reference_price_usd === null || row.reference_price_usd < 0,
      );
      if (missingReferencePrices.length > 0) {
        blockers.push({
          code: "missing_reference_price",
          message: `${missingReferencePrices.length} publishable SKUs have no published USD Reference Price: ${missingReferencePrices
            .slice(0, 8)
            .map((row) => row.sku)
            .join(
              ", ",
            )}. / ${missingReferencePrices.length} 个待发布 SKU 缺少已发布的 USD 零售单价。`,
        });
      }

      const missingMainImages = await database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM catalog_skus product
           LEFT JOIN catalog_product_main_images image
             ON image.import_id = product.import_id
            AND image.sku = product.sku
            AND image.assignment_kind = 'override'
           LEFT JOIN catalog_hose_variants hose
             ON hose.import_id = product.import_id AND hose.sku = product.sku
           LEFT JOIN catalog_hose_series hose_series
             ON hose_series.import_id = hose.import_id
            AND hose_series.series_code = hose.hose_series
           LEFT JOIN catalog_hose_ends hose_end
             ON hose_end.import_id = product.import_id
            AND hose_end.sku = product.sku
           LEFT JOIN catalog_hose_end_series hose_end_series
             ON hose_end_series.import_id = hose_end.import_id
            AND hose_end_series.series_code = hose_end.fitting_series
           LEFT JOIN catalog_media_versions media
             ON media.id = COALESCE(
               image.media_version_id,
               hose_series.representative_media_version_id,
               hose_end_series.representative_media_version_id
             )
           WHERE product.import_id = ?
             AND product.catalog_publication_status = 'Published'
             AND (
               media.id IS NULL
               OR (
                 media.approved_reference IS NULL
                 AND media.storefront_object_key IS NULL
               )
               OR (
                 media.approved_reference IS NOT NULL
                 AND media.approved_reference NOT LIKE 'hose-series:%'
                 AND media.approved_reference NOT LIKE 'hose-end-shape:%'
               )
             )`,
        )
        .bind(draft.source_import_id)
        .first<{ count: number }>();
      if ((missingMainImages?.count ?? 0) > 0) {
        blockers.push({
          code: "missing_main_image",
          message: `${missingMainImages?.count} publishable SKUs do not resolve exactly one web-renderable reviewed representative or override image. / ${missingMainImages?.count} 个待发布 SKU 无法解析唯一且可在客户页面显示的已审核系列代表图或子体覆盖图。`,
        });
      }

      const impact = await database
        .prepare(
          `SELECT input_fingerprint, affected_series_json, status
           FROM catalog_assembly_impact_analyses WHERE release_id = ?`,
        )
        .bind(draft.id)
        .first<{
          affected_series_json: string;
          input_fingerprint: string;
          status: "current" | "stale";
        }>();
      if (!impact) {
        blockers.push({
          code: "missing_assembly_impact",
          message:
            "Assembly impact must be calculated before this release can publish.",
        });
      } else if (impact.status === "stale") {
        blockers.push({
          code: "stale_derived_assembly_data",
          message:
            "Affected Hose Series are stale. Run Update Assembly Data before publication.",
        });
      }

      try {
        const snapshot = await createD1ConfiguratorReferenceRepository(
          database,
        ).findSnapshot(draft.id);
        if (!snapshot) {
          blockers.push({
            code: "missing_configurator_registry_snapshot",
            message: "Configurator reference data is missing for this release.",
          });
        } else {
          blockers.push(...validateConfiguratorReferenceSnapshot(snapshot));
        }
      } catch (error) {
        blockers.push({
          code: "invalid_configurator_registry_payload",
          message:
            error instanceof Error
              ? `Configurator reference data is invalid: ${error.message}`
              : "Configurator reference data is invalid.",
        });
      }

      const orphanedAssignments = await database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM catalog_configurator_registry_entries entry
           LEFT JOIN catalog_hose_ends hose_end
             ON hose_end.import_id = ?
            AND hose_end.sku = json_extract(entry.payload_json, '$.hoseEndSku')
           WHERE entry.release_id = ?
             AND entry.registry_type = 'endpoint_assignment'
             AND hose_end.sku IS NULL`,
        )
        .bind(draft.source_import_id, draft.id)
        .first<{ count: number }>();
      if ((orphanedAssignments?.count ?? 0) > 0) {
        blockers.push({
          code: "orphaned_endpoint_assignment",
          message: `${orphanedAssignments?.count} endpoint assignments reference Hose End SKUs outside this release.`,
        });
      }

      const [
        draftProducts,
        activeProducts,
        draftPrices,
        activePrices,
        draftImages,
        activeImages,
        draftRelationships,
        activeRelationships,
        draftDerivedCombinations,
        activeDerivedCombinations,
        assemblyState,
      ] = await Promise.all([
        publicProductFingerprints(database, draft.source_import_id),
        publicProductFingerprints(
          database,
          activeRelease?.sourceImportId ?? null,
        ),
        priceFingerprints(database, draft.source_import_id),
        priceFingerprints(database, activeRelease?.sourceImportId ?? null),
        imageFingerprints(database, draft.source_import_id),
        imageFingerprints(database, activeRelease?.sourceImportId ?? null),
        relationshipFingerprints(database, draft.source_import_id),
        relationshipFingerprints(
          database,
          activeRelease?.sourceImportId ?? null,
        ),
        derivedCombinationFingerprints(database, draft.id),
        activeRelease
          ? derivedCombinationFingerprints(database, activeRelease.id)
          : Promise.resolve(new Map<string, string>()),
        publicationAssemblyState(database, draft.id),
      ]);
      const productDifferences = diffFingerprints(
        draftProducts,
        activeProducts,
      );
      const priceDifferences = diffFingerprints(draftPrices, activePrices);
      const imageDifferences = diffFingerprints(draftImages, activeImages);
      const relationshipDifferences = diffFingerprints(
        draftRelationships,
        activeRelationships,
      );
      const derivedDifferences = diffFingerprints(
        draftDerivedCombinations,
        activeDerivedCombinations,
      );
      const differences = {
        additions: productDifferences.additions,
        changes: [
          ...productDifferences.changes,
          ...priceDifferences.additions.map((key) => `Reference Price ${key}`),
          ...priceDifferences.changes.map((key) => `Reference Price ${key}`),
          ...priceDifferences.removals.map((key) => `Reference Price ${key}`),
          ...imageDifferences.additions.map((key) => `Main Image ${key}`),
          ...imageDifferences.changes.map((key) => `Main Image ${key}`),
          ...imageDifferences.removals.map((key) => `Main Image ${key}`),
          ...relationshipDifferences.additions,
          ...relationshipDifferences.changes,
          ...relationshipDifferences.removals,
          ...derivedDifferences.additions.map((key) => `Assembly ${key}`),
          ...derivedDifferences.changes.map((key) => `Assembly ${key}`),
          ...derivedDifferences.removals.map((key) => `Assembly ${key}`),
        ],
        deactivations: productDifferences.removals,
      };
      const hoseSeriesCount = await database
        .prepare(
          `SELECT COUNT(DISTINCT hose_series) AS count
           FROM catalog_skus
           WHERE import_id = ? AND product_type = 'hose'
             AND hose_series IS NOT NULL`,
        )
        .bind(draft.source_import_id)
        .first<{ count: number }>();
      if (
        impact?.status === "current" &&
        assemblyState.derivedSeriesCount !== (hoseSeriesCount?.count ?? 0)
      ) {
        blockers.push({
          code: "incomplete_derived_assembly_data",
          message: `Derived Assembly Data covers ${assemblyState.derivedSeriesCount} of ${hoseSeriesCount?.count ?? 0} Hose Series.`,
        });
      }
      let affectedSeries: string[] = [];
      try {
        const parsed: unknown = JSON.parse(
          impact?.affected_series_json ?? "[]",
        );
        if (Array.isArray(parsed)) {
          affectedSeries = parsed.filter(
            (value): value is string => typeof value === "string",
          );
        }
      } catch {
        blockers.push({
          code: "invalid_assembly_impact",
          message: "Affected Hose Series data is invalid.",
        });
      }
      return {
        activeGeneration: activeRow.active_generation,
        activeRelease,
        ...differences,
        affectedSeries,
        assemblyState,
        blockers,
        derivedCombinations: derivedDifferences,
        draftRelease: releaseFromDraft(draft),
        images: imageDifferences,
        prices: priceDifferences,
        products: productDifferences,
        relationships: relationshipDifferences,
        warnings,
      };
    },

    async recordRejection(input) {
      await database
        .prepare(
          `INSERT OR IGNORE INTO admin_audit_events (
             id, event_type, entity_type, entity_id,
             actor_id, payload_json, occurred_at
           ) VALUES (?, 'catalog_release.publication_rejected',
                     'catalog_release', ?, ?, ?, ?)`,
        )
        .bind(
          input.auditEventId,
          input.releaseId,
          input.actorId,
          JSON.stringify({
            code: input.code,
            ipAddress: input.ipAddress,
            message: input.message,
            requestCorrelationId: input.requestCorrelationId,
          }),
          input.occurredAt,
        )
        .run();
    },

    async publish(operation: CatalogPublicationOperation) {
      const payload = JSON.stringify({
        after: {
          activeReleaseId: operation.releaseId,
          differences: operation.differences,
        },
        before: { activeReleaseId: operation.previousReleaseId },
        differences: operation.differences,
        ipAddress: operation.ipAddress,
        previousReleaseId: operation.previousReleaseId,
        requestCorrelationId: operation.requestCorrelationId,
        ...operation.summary,
      });
      await database.batch([
        database
          .prepare(
            `INSERT INTO catalog_derived_assembly_series (
               release_id, source_import_id, hose_series, generation_id,
               input_fingerprint, combination_count, generated_at, generated_by
             )
             SELECT ?, target.source_import_id, active_series.hose_series,
                    active_series.generation_id,
                    active_series.input_fingerprint,
                    active_series.combination_count,
                    active_series.generated_at, active_series.generated_by
             FROM catalog_releases target
             INNER JOIN catalog_assembly_impact_analyses impact
               ON impact.release_id = target.id AND impact.status = 'current'
             INNER JOIN catalog_derived_assembly_series active_series
               ON active_series.release_id = impact.baseline_release_id
             WHERE target.id = ? AND target.status = 'draft'
               AND EXISTS (
                 SELECT 1 FROM catalog_skus hose
                 WHERE hose.import_id = target.source_import_id
                   AND hose.product_type = 'hose'
                   AND hose.hose_series = active_series.hose_series
               )
               AND NOT EXISTS (
                 SELECT 1 FROM catalog_derived_assembly_series existing
                 WHERE existing.release_id = target.id
                   AND existing.hose_series = active_series.hose_series
               )`,
          )
          .bind(operation.releaseId, operation.releaseId),
        database
          .prepare(
            `INSERT INTO catalog_derived_assembly_combinations (
               id, release_id, source_import_id, hose_series, hose_sku,
               end_a_compatibility_id, end_a_hose_end_sku, end_a_ferrule_sku,
               end_b_compatibility_id, end_b_hose_end_sku, end_b_ferrule_sku,
               end_a_relationship_fingerprint, end_b_relationship_fingerprint,
               combination_fingerprint, generated_at
             )
             SELECT lower(hex(randomblob(16))), ?, target.source_import_id,
                    active.hose_series, active.hose_sku,
                    active.end_a_compatibility_id, active.end_a_hose_end_sku,
                    active.end_a_ferrule_sku, active.end_b_compatibility_id,
                    active.end_b_hose_end_sku, active.end_b_ferrule_sku,
                    active.end_a_relationship_fingerprint,
                    active.end_b_relationship_fingerprint,
                    active.combination_fingerprint, active.generated_at
             FROM catalog_releases target
             INNER JOIN catalog_assembly_impact_analyses impact
               ON impact.release_id = target.id AND impact.status = 'current'
             INNER JOIN catalog_derived_assembly_combinations active
               ON active.release_id = impact.baseline_release_id
             INNER JOIN catalog_derived_assembly_series target_series
               ON target_series.release_id = target.id
              AND target_series.hose_series = active.hose_series
             INNER JOIN catalog_derived_assembly_series active_series
               ON active_series.release_id = impact.baseline_release_id
              AND active_series.hose_series = active.hose_series
              AND active_series.generation_id = target_series.generation_id
              AND active_series.input_fingerprint = target_series.input_fingerprint
             WHERE target.id = ? AND target.status = 'draft'
               AND NOT EXISTS (
                 SELECT 1 FROM catalog_derived_assembly_combinations existing
                 WHERE existing.release_id = target.id
                   AND existing.hose_sku = active.hose_sku
                   AND existing.end_a_compatibility_id = active.end_a_compatibility_id
                   AND existing.end_b_compatibility_id = active.end_b_compatibility_id
               )`,
          )
          .bind(operation.releaseId, operation.releaseId),
        database
          .prepare(
            `INSERT INTO catalog_release_publications (
               release_id, previous_release_id, expected_active_version,
               expected_draft_version, published_by, request_correlation_id,
               published_at, expected_assembly_input_fingerprint,
               expected_assembly_generation_id, expected_derived_series_count,
               expected_derived_combination_count, summary_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            operation.releaseId,
            operation.previousReleaseId,
            operation.expectedActiveGeneration,
            operation.expectedDraftVersion,
            operation.actorId,
            operation.requestCorrelationId,
            operation.publishedAt,
            operation.expectedAssemblyState.inputFingerprint,
            operation.expectedAssemblyState.generationId,
            operation.expectedAssemblyState.derivedSeriesCount,
            operation.expectedAssemblyState.derivedCombinationCount,
            JSON.stringify({
              ...operation.summary,
              differences: operation.differences,
            }),
          ),
        database
          .prepare(
            `UPDATE catalog_releases
             SET status = 'superseded'
             WHERE id = ? AND status = 'published'`,
          )
          .bind(operation.previousReleaseId),
        database
          .prepare(
            `UPDATE catalog_releases
             SET status = 'superseded'
             WHERE status = 'draft'
               AND id <> ?
               AND created_at <= (
                 SELECT created_at FROM catalog_releases WHERE id = ?
               )`,
          )
          .bind(operation.releaseId, operation.releaseId),
        database
          .prepare(
            `UPDATE catalog_releases
             SET status = 'published', published_at = ?, version = version + 1
             WHERE id = ? AND status = 'draft' AND version = ?`,
          )
          .bind(
            operation.publishedAt,
            operation.releaseId,
            operation.expectedDraftVersion,
          ),
        database
          .prepare(
            `UPDATE catalog_active_release
             SET release_id = ?, version = version + 1, updated_at = ?
             WHERE singleton = 1`,
          )
          .bind(operation.releaseId, operation.publishedAt),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id,
               actor_id, payload_json, occurred_at
             ) VALUES (?, 'catalog_release.published', 'catalog_release', ?, ?, ?, ?)`,
          )
          .bind(
            operation.auditEventId,
            operation.releaseId,
            operation.actorId,
            payload,
            operation.publishedAt,
          ),
      ]);

      const active = await findActiveRow();
      if (active?.id !== operation.releaseId) {
        throw new Error("Catalog Release activation did not complete");
      }
    },
  };
}
