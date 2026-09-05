import type {
  CatalogCommercialMaintenanceRepository,
  CatalogSeriesOption,
  CommercialProductType,
  SeriesCommercialRule,
  SkuPricePackaging,
} from "../domain/catalog-commercial-maintenance";
import { inferProductLifecycleStatus } from "../domain/catalog-product-lifecycle";
import { prepareCatalogDraftMutation } from "./d1-catalog-manual-hose-repository";

interface ReleaseRow {
  source_import_id: string;
}

interface SeriesRuleRow {
  continuous_length_confirmation: string | null;
  country_of_origin: string;
  hs_code: string | null;
  lead_time_days: number;
  length_increment_ft: number | null;
  minimum_length_per_piece_ft: number | null;
  moq: number;
  notes: string | null;
  preset_length_1_ft: number | null;
  preset_length_2_ft: number | null;
  preset_length_3_ft: number | null;
  product_type: CommercialProductType;
  quantity_input_mode: string;
  sales_unit: string;
  series_code: string;
}

interface ExactRow {
  carton_gross_weight_kg: number | null;
  carton_h_cm: number | null;
  carton_l_cm: number | null;
  carton_w_cm: number | null;
  currency: "USD";
  inner_pack_qty: number | null;
  master_carton_qty: number | null;
  net_unit_weight_kg: number | null;
  package_length_ft: number | null;
  packing_basis: string | null;
  reference_price_usd: number | null;
  sales_sku: string;
  sku: string;
  units_per_sales_pack: number | null;
}

async function maintenanceImportId(database: D1Database) {
  const row = await database
    .prepare(
      `SELECT release.source_import_id
       FROM catalog_releases release
       LEFT JOIN catalog_active_release pointer ON pointer.release_id = release.id
       WHERE (
         release.status = 'draft'
         AND (
           (SELECT release_id FROM catalog_active_release WHERE singleton = 1) IS NULL
           OR release.created_at > COALESCE(
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
       ) OR pointer.singleton = 1
       ORDER BY (release.status = 'draft') DESC, release.created_at DESC, release.id DESC
       LIMIT 1`,
    )
    .first<ReleaseRow>();
  return row?.source_import_id ?? null;
}

function seriesSelect() {
  return `
    SELECT 'hose' AS product_type, series_code, COALESCE(series_name, series_code) AS series_name
    FROM catalog_hose_series WHERE import_id = ?1
    UNION ALL
    SELECT 'hose_end', series_code, series_name
    FROM catalog_hose_end_series WHERE import_id = ?1
    UNION ALL
    SELECT 'ferrule', ferrule_series, ferrule_series
    FROM catalog_ferrules WHERE import_id = ?1 GROUP BY ferrule_series
    UNION ALL
    SELECT 'adapter', adapter_family_id, COALESCE(website_product_name, adapter_family_id)
    FROM catalog_adapter_families WHERE import_id = ?1 GROUP BY adapter_family_id
    UNION ALL
    SELECT 'quick_coupler', coupler_series, coupler_series
    FROM catalog_quick_couplers WHERE import_id = ?1 GROUP BY coupler_series`;
}

function toRule(row: SeriesRuleRow): SeriesCommercialRule {
  return {
    continuousLengthConfirmation: row.continuous_length_confirmation,
    countryOfOrigin: row.country_of_origin,
    hsCode: row.hs_code,
    leadTimeDays: row.lead_time_days,
    lengthIncrementFt: row.length_increment_ft,
    minimumLengthPerPieceFt: row.minimum_length_per_piece_ft,
    moq: row.moq,
    notes: row.notes,
    presetLength1Ft: row.preset_length_1_ft,
    presetLength2Ft: row.preset_length_2_ft,
    presetLength3Ft: row.preset_length_3_ft,
    productType: row.product_type,
    quantityInputMode: row.quantity_input_mode,
    salesUnit: row.sales_unit,
    seriesCode: row.series_code,
  };
}

function toExact(row: ExactRow): SkuPricePackaging {
  return {
    cartonGrossWeightKg: row.carton_gross_weight_kg,
    cartonHCm: row.carton_h_cm,
    cartonLCm: row.carton_l_cm,
    cartonWCm: row.carton_w_cm,
    currency: row.currency,
    innerPackQty: row.inner_pack_qty,
    masterCartonQty: row.master_carton_qty,
    netUnitWeightKg: row.net_unit_weight_kg,
    packageLengthFt: row.package_length_ft,
    packingBasis: row.packing_basis,
    referencePrice: row.reference_price_usd,
    salesSku: row.sales_sku,
    sku: row.sku,
    unitsPerSalesPack: row.units_per_sales_pack,
  };
}

export function createD1CatalogCommercialMaintenanceRepository(
  database: D1Database,
): CatalogCommercialMaintenanceRepository {
  const repository: CatalogCommercialMaintenanceRepository = {
    async findSeries(productType, seriesCode) {
      const importId = await maintenanceImportId(database);
      if (!importId) return null;
      const row = await database
        .prepare(
          `SELECT product_type, series_code, series_name FROM (${seriesSelect()})
           WHERE product_type = ?2 AND series_code = ?3`,
        )
        .bind(importId, productType, seriesCode.trim().toUpperCase())
        .first<{
          product_type: CommercialProductType;
          series_code: string;
          series_name: string;
        }>();
      return row
        ? {
            productType: row.product_type,
            seriesCode: row.series_code,
            seriesName: row.series_name,
          }
        : null;
    },

    async findSeriesRule(productType, seriesCode) {
      const importId = await maintenanceImportId(database);
      if (!importId) return null;
      const row = await database
        .prepare(
          `SELECT * FROM catalog_series_commercial_rules
           WHERE import_id = ? AND product_type = ? AND series_code = ?`,
        )
        .bind(importId, productType, seriesCode.trim().toUpperCase())
        .first<SeriesRuleRow>();
      if (row) return toRule(row);
      const legacy = await database
        .prepare(
          `SELECT offer.continuous_length_confirmation,
                  offer.country_of_origin, offer.hs_code,
                  offer.lead_time_days, offer.length_increment_ft,
                  offer.minimum_length_per_piece_ft, offer.moq, offer.notes,
                  offer.preset_length_1_ft, offer.preset_length_2_ft,
                  offer.preset_length_3_ft, product.product_type,
                  offer.quantity_input_mode, offer.sales_unit,
                  CASE product.product_type
                    WHEN 'hose' THEN hose.hose_series
                    WHEN 'hose_end' THEN hose_end.fitting_series
                    WHEN 'ferrule' THEN ferrule.ferrule_series
                    WHEN 'adapter' THEN adapter.adapter_family_id
                    WHEN 'quick_coupler' THEN coupler.coupler_series
                  END AS series_code
           FROM catalog_sales_offers offer
           INNER JOIN catalog_skus product
             ON product.import_id = offer.import_id AND product.sku = offer.base_sku
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
           WHERE offer.import_id = ? AND product.product_type = ?
             AND CASE product.product_type
               WHEN 'hose' THEN hose.hose_series
               WHEN 'hose_end' THEN hose_end.fitting_series
               WHEN 'ferrule' THEN ferrule.ferrule_series
               WHEN 'adapter' THEN adapter.adapter_family_id
               WHEN 'quick_coupler' THEN coupler.coupler_series
             END = ?
           ORDER BY product.sku LIMIT 1`,
        )
        .bind(importId, productType, seriesCode.trim().toUpperCase())
        .first<SeriesRuleRow>();
      return legacy ? toRule(legacy) : null;
    },

    async findSku(sku) {
      const importId = await maintenanceImportId(database);
      if (!importId) return null;
      const row = await database
        .prepare(
          `SELECT product.sku, product.product_type,
             product.catalog_publication_status, product.supply_availability,
             CASE product.product_type
               WHEN 'hose' THEN hose.hose_series
               WHEN 'hose_end' THEN hose_end.fitting_series
               WHEN 'ferrule' THEN ferrule.ferrule_series
               WHEN 'adapter' THEN adapter.adapter_family_id
               WHEN 'quick_coupler' THEN coupler.coupler_series
             END AS series_code
           FROM catalog_skus product
           LEFT JOIN catalog_hose_variants hose ON hose.import_id = product.import_id AND hose.sku = product.sku
           LEFT JOIN catalog_hose_ends hose_end ON hose_end.import_id = product.import_id AND hose_end.sku = product.sku
           LEFT JOIN catalog_ferrules ferrule ON ferrule.import_id = product.import_id AND ferrule.sku = product.sku
           LEFT JOIN catalog_adapters adapter ON adapter.import_id = product.import_id AND adapter.sku = product.sku
           LEFT JOIN catalog_quick_couplers coupler ON coupler.import_id = product.import_id AND coupler.sku = product.sku
           WHERE product.import_id = ? AND product.sku = ?`,
        )
        .bind(importId, sku.trim().toUpperCase())
        .first<{
          catalog_publication_status: "Archived" | "Draft" | "Published";
          product_type: CommercialProductType;
          series_code: string | null;
          sku: string;
          supply_availability:
            "available_for_quote" | "discontinued" | "temporarily_unavailable";
        }>();
      if (!row?.series_code) return null;
      return {
        lifecycleStatus: inferProductLifecycleStatus({
          catalogPublicationStatus: row.catalog_publication_status,
          supplyAvailability: row.supply_availability,
        }),
        productType: row.product_type,
        seriesCode: row.series_code,
        sku: row.sku,
      };
    },

    async findSkuPricePackaging(sku) {
      const importId = await maintenanceImportId(database);
      if (!importId) return null;
      const row = await database
        .prepare(
          `SELECT * FROM catalog_sku_price_packaging
           WHERE import_id = ? AND sku = ?`,
        )
        .bind(importId, sku.trim().toUpperCase())
        .first<ExactRow>();
      if (row) return toExact(row);
      const legacy = await database
        .prepare(
          `SELECT offer.base_sku AS sku, offer.base_sku AS sales_sku,
                  offer.reference_price_usd, 'USD' AS currency,
                  offer.package_length_ft, offer.units_per_sales_pack,
                  offer.net_unit_weight_kg, offer.inner_pack_qty,
                  offer.master_carton_qty, offer.carton_gross_weight_kg,
                  offer.carton_l_cm, offer.carton_w_cm, offer.carton_h_cm,
                  offer.packing_basis
           FROM catalog_sales_offers offer
           WHERE offer.import_id = ? AND offer.base_sku = ?`,
        )
        .bind(importId, sku.trim().toUpperCase())
        .first<ExactRow>();
      return legacy ? toExact(legacy) : null;
    },

    async listSeries(productType) {
      const importId = await maintenanceImportId(database);
      if (!importId) return [];
      const rows = await database
        .prepare(
          `SELECT product_type, series_code, series_name FROM (${seriesSelect()})
           WHERE product_type = ?2 ORDER BY series_code`,
        )
        .bind(importId, productType)
        .all<{
          product_type: CommercialProductType;
          series_code: string;
          series_name: string;
        }>();
      return rows.results.map((row): CatalogSeriesOption => ({
        productType: row.product_type,
        seriesCode: row.series_code,
        seriesName: row.series_name,
      }));
    },

    async saveSeriesRule(operation) {
      const before = await repository.findSeriesRule(
        operation.rule.productType,
        operation.rule.seriesCode,
      );
      const { creationStatements, draft } = await prepareCatalogDraftMutation(
        database,
        operation,
      );
      const rule = operation.rule;
      await database.batch([
        ...creationStatements,
        database
          .prepare(
            `INSERT INTO catalog_series_commercial_rules (
               id, import_id, product_type, series_code, sales_unit, moq,
               lead_time_days, country_of_origin, hs_code, notes,
               quantity_input_mode, minimum_length_per_piece_ft,
               length_increment_ft, preset_length_1_ft, preset_length_2_ft,
               preset_length_3_ft, continuous_length_confirmation
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(import_id, product_type, series_code) DO UPDATE SET
               sales_unit = excluded.sales_unit, moq = excluded.moq,
               lead_time_days = excluded.lead_time_days,
               country_of_origin = excluded.country_of_origin,
               hs_code = excluded.hs_code, notes = excluded.notes,
               quantity_input_mode = excluded.quantity_input_mode,
               minimum_length_per_piece_ft = excluded.minimum_length_per_piece_ft,
               length_increment_ft = excluded.length_increment_ft,
               preset_length_1_ft = excluded.preset_length_1_ft,
               preset_length_2_ft = excluded.preset_length_2_ft,
               preset_length_3_ft = excluded.preset_length_3_ft,
               continuous_length_confirmation = excluded.continuous_length_confirmation`,
          )
          .bind(
            operation.ruleId,
            draft.source_import_id,
            rule.productType,
            rule.seriesCode,
            rule.salesUnit,
            rule.moq,
            rule.leadTimeDays,
            rule.countryOfOrigin,
            rule.hsCode,
            rule.notes,
            rule.quantityInputMode,
            rule.minimumLengthPerPieceFt,
            rule.lengthIncrementFt,
            rule.presetLength1Ft,
            rule.presetLength2Ft,
            rule.presetLength3Ft,
            rule.continuousLengthConfirmation,
          ),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id, actor_id, payload_json, occurred_at
             ) VALUES (?, 'catalog_commercial.series_rule_saved',
                       'catalog_series', ?, ?, ?, ?)`,
          )
          .bind(
            operation.auditEventId,
            `${rule.productType}:${rule.seriesCode}`,
            operation.actorId,
            JSON.stringify({
              after: rule,
              before,
              draftReleaseId: draft.id,
              ipAddress: operation.ipAddress,
              requestCorrelationId: operation.requestCorrelationId,
            }),
            operation.occurredAt,
          ),
      ]);
      return { draftReleaseId: draft.id };
    },

    async saveSkuPricePackaging(operation) {
      const before = await repository.findSkuPricePackaging(
        operation.packaging.sku,
      );
      const { creationStatements, draft } = await prepareCatalogDraftMutation(
        database,
        operation,
      );
      const exact = operation.packaging;
      await database.batch([
        ...creationStatements,
        database
          .prepare(
            `INSERT INTO catalog_sku_price_packaging (
               id, import_id, sku, sales_sku, reference_price_usd, currency,
               package_length_ft, units_per_sales_pack, net_unit_weight_kg,
               inner_pack_qty, master_carton_qty, carton_gross_weight_kg,
               carton_l_cm, carton_w_cm, carton_h_cm, packing_basis
             ) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(import_id, sku) DO UPDATE SET
               sales_sku = excluded.sales_sku,
               reference_price_usd = excluded.reference_price_usd,
               currency = 'USD', package_length_ft = excluded.package_length_ft,
               units_per_sales_pack = excluded.units_per_sales_pack,
               net_unit_weight_kg = excluded.net_unit_weight_kg,
               inner_pack_qty = excluded.inner_pack_qty,
               master_carton_qty = excluded.master_carton_qty,
               carton_gross_weight_kg = excluded.carton_gross_weight_kg,
               carton_l_cm = excluded.carton_l_cm,
               carton_w_cm = excluded.carton_w_cm,
               carton_h_cm = excluded.carton_h_cm,
               packing_basis = excluded.packing_basis`,
          )
          .bind(
            operation.pricePackagingId,
            draft.source_import_id,
            exact.sku,
            exact.salesSku,
            exact.referencePrice,
            exact.packageLengthFt,
            exact.unitsPerSalesPack,
            exact.netUnitWeightKg,
            exact.innerPackQty,
            exact.masterCartonQty,
            exact.cartonGrossWeightKg,
            exact.cartonLCm,
            exact.cartonWCm,
            exact.cartonHCm,
            exact.packingBasis,
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
             )
             SELECT ?, product.import_id, product.sku, product.sku,
               product.product_type, rule.sales_unit, ?, COALESCE(?, 1),
               rule.moq, ?, rule.lead_time_days, rule.country_of_origin,
               'USD', ?, ?, ?, ?, ?, ?, ?, ?, rule.hs_code, rule.notes,
               product.catalog_publication_status, product.rfq_eligibility,
               product.technical_data_status, rule.quantity_input_mode,
               rule.minimum_length_per_piece_ft, rule.length_increment_ft,
               rule.preset_length_1_ft, rule.preset_length_2_ft,
               rule.preset_length_3_ft, rule.continuous_length_confirmation
             FROM catalog_skus product
             INNER JOIN catalog_series_commercial_rules rule
               ON rule.import_id = product.import_id
              AND rule.product_type = product.product_type
              AND rule.series_code = ?
             WHERE product.import_id = ? AND product.sku = ?
             ON CONFLICT(import_id, base_sku) DO UPDATE SET
               package_length_ft = excluded.package_length_ft,
               units_per_sales_pack = excluded.units_per_sales_pack,
               net_unit_weight_kg = excluded.net_unit_weight_kg,
               currency = 'USD', reference_price_usd = excluded.reference_price_usd,
               inner_pack_qty = excluded.inner_pack_qty,
               master_carton_qty = excluded.master_carton_qty,
               carton_gross_weight_kg = excluded.carton_gross_weight_kg,
               carton_l_cm = excluded.carton_l_cm,
               carton_w_cm = excluded.carton_w_cm,
               carton_h_cm = excluded.carton_h_cm,
               packing_basis = excluded.packing_basis`,
          )
          .bind(
            `${operation.pricePackagingId}:legacy`,
            exact.packageLengthFt,
            exact.unitsPerSalesPack,
            exact.netUnitWeightKg,
            exact.referencePrice,
            exact.innerPackQty,
            exact.masterCartonQty,
            exact.cartonGrossWeightKg,
            exact.cartonLCm,
            exact.cartonWCm,
            exact.cartonHCm,
            exact.packingBasis,
            operation.skuRecord.seriesCode,
            draft.source_import_id,
            exact.sku,
          ),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id, actor_id, payload_json, occurred_at
             ) VALUES (?, 'catalog_commercial.sku_price_packaging_saved',
                       'catalog_sku', ?, ?, ?, ?)`,
          )
          .bind(
            operation.auditEventId,
            exact.sku,
            operation.actorId,
            JSON.stringify({
              after: exact,
              before,
              draftReleaseId: draft.id,
              ipAddress: operation.ipAddress,
              requestCorrelationId: operation.requestCorrelationId,
            }),
            operation.occurredAt,
          ),
        database
          .prepare(
            `UPDATE catalog_imports
             SET summary_json = json_set(
               summary_json,
               '$.salesOfferCount',
                 (SELECT COUNT(*) FROM catalog_sales_offers WHERE import_id = ?1),
               '$.referencePriceCount',
                 (SELECT COUNT(*) FROM catalog_sales_offers
                  WHERE import_id = ?1 AND reference_price_usd IS NOT NULL)
             )
             WHERE id = ?1`,
          )
          .bind(draft.source_import_id),
      ]);
      return { draftReleaseId: draft.id };
    },
  };
  return repository;
}
