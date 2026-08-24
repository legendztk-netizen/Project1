import type {
  ApplyDraftAvailabilityChangeOperation,
  DraftAvailabilityCandidate,
  DraftAvailabilityRepository,
  DraftCatalogReview,
  DraftCatalogReviewFilters,
  DraftProductSelector,
  SupplyAvailability,
} from "../domain/catalog-draft-availability";

interface ReleaseRow {
  created_at: string;
  id: string;
  release_number: string;
  source_import_id: string;
}

interface ProductRow {
  catalog_publication_status: string;
  cost_basis_currency: string | null;
  factory_unit_price: number | null;
  hose_series: string | null;
  price_incoterm: string | null;
  product_type: string;
  reference_price_usd: number | null;
  rfq_eligibility: string;
  sku: string;
  source_worksheet: string;
  supply_availability: SupplyAvailability;
  technical_data_status: string;
}

interface CandidateRow {
  sku: string;
  supply_availability: SupplyAvailability;
}

function normalizedFilters(
  filters: Partial<DraftCatalogReviewFilters>,
): DraftCatalogReviewFilters {
  const value = (candidate: string | null | undefined) =>
    candidate?.trim() || null;
  return {
    hoseSeries: value(filters.hoseSeries),
    sku: value(filters.sku)?.toUpperCase() ?? null,
    sourceWorksheet: value(filters.sourceWorksheet),
  };
}

async function findDraftRelease(
  database: D1Database,
  releaseId?: string | null,
) {
  const idClause = releaseId ? "AND catalog_releases.id = ?" : "";
  const statement = database.prepare(
    `SELECT catalog_releases.id, catalog_releases.release_number,
            catalog_releases.source_import_id, catalog_releases.created_at
     FROM catalog_releases
     INNER JOIN catalog_imports
       ON catalog_imports.id = catalog_releases.source_import_id
     WHERE catalog_releases.status = 'draft'
       AND catalog_imports.kind = 'workbook'
       AND catalog_imports.status = 'completed'
       ${idClause}
     ORDER BY catalog_releases.created_at DESC
     LIMIT 1`,
  );
  return (
    releaseId ? statement.bind(releaseId) : statement
  ).first<ReleaseRow>();
}

function filterClause(filters: DraftCatalogReviewFilters) {
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (filters.sourceWorksheet) {
    clauses.push("catalog_skus.source_worksheet = ?");
    bindings.push(filters.sourceWorksheet);
  }
  if (filters.hoseSeries) {
    clauses.push("catalog_skus.hose_series = ?");
    bindings.push(filters.hoseSeries);
  }
  if (filters.sku) {
    clauses.push("catalog_skus.sku = ?");
    bindings.push(filters.sku);
  }
  return {
    bindings,
    sql: clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "",
  };
}

function toProduct(row: ProductRow) {
  return {
    catalogPublicationStatus: row.catalog_publication_status,
    costBasisCurrency: row.cost_basis_currency,
    factoryUnitPrice: row.factory_unit_price,
    hoseSeries: row.hose_series,
    priceIncoterm: row.price_incoterm,
    productType: row.product_type,
    referencePriceUsd: row.reference_price_usd,
    rfqEligibility: row.rfq_eligibility,
    sku: row.sku,
    sourceWorksheet: row.source_worksheet,
    supplyAvailability: row.supply_availability,
    technicalDataStatus: row.technical_data_status,
  };
}

function selectorClause(selector: DraftProductSelector) {
  if (selector.mode === "worksheet") {
    return {
      bindings: [selector.sourceWorksheet],
      sql: "AND catalog_skus.source_worksheet = ?",
    };
  }
  if (selector.mode === "hose_series") {
    return {
      bindings: [selector.hoseSeries],
      sql: "AND catalog_skus.hose_series = ?",
    };
  }
  return {
    bindings: [JSON.stringify(selector.skus)],
    sql: "AND catalog_skus.sku IN (SELECT value FROM json_each(?))",
  };
}

export function createD1CatalogDraftReviewRepository(
  database: D1Database,
): DraftAvailabilityRepository & {
  findDraftCatalogReview(
    releaseId: string | null,
    filters: Partial<DraftCatalogReviewFilters>,
  ): Promise<DraftCatalogReview | null>;
} {
  return {
    async applyAvailabilityChange(
      operation: ApplyDraftAvailabilityChangeOperation,
    ) {
      const skuJson = JSON.stringify(operation.affectedSkus);
      const payloadJson = JSON.stringify({
        affectedCount: operation.affectedCount,
        affectedSkus: operation.affectedSkus,
        matchedCount: operation.matchedCount,
        selector: operation.selector,
        target: operation.target,
      });
      await database.batch([
        database
          .prepare(
            `UPDATE catalog_skus
             SET supply_availability = ?
             WHERE import_id = (
               SELECT source_import_id FROM catalog_releases
               WHERE id = ? AND status = 'draft'
             )
             AND sku IN (SELECT value FROM json_each(?))
             AND supply_availability <> ?`,
          )
          .bind(
            operation.target,
            operation.releaseId,
            skuJson,
            operation.target,
          ),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id,
               actor_id, payload_json, occurred_at
             )
             SELECT ?, 'catalog_release.supply_availability_bulk_changed',
                    'catalog_release', ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM catalog_releases
               WHERE id = ? AND status = 'draft'
             )`,
          )
          .bind(
            operation.auditEventId,
            operation.releaseId,
            operation.actorId,
            payloadJson,
            operation.occurredAt,
            operation.releaseId,
          ),
      ]);

      const verification = await database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM catalog_skus
           WHERE import_id = (
             SELECT source_import_id FROM catalog_releases
             WHERE id = ? AND status = 'draft'
           )
           AND sku IN (SELECT value FROM json_each(?))
           AND supply_availability = ?`,
        )
        .bind(operation.releaseId, skuJson, operation.target)
        .first<{ count: number }>();
      if (verification?.count !== operation.affectedCount) {
        throw new Error(
          "Draft release changed before the bulk command completed",
        );
      }
    },

    async findAvailabilityCandidates(
      releaseId: string,
      selector: DraftProductSelector,
    ): Promise<DraftAvailabilityCandidate[]> {
      if (selector.mode === "selected" && selector.skus.length === 0) return [];
      const selected = selectorClause(selector);
      const result = await database
        .prepare(
          `SELECT catalog_skus.sku, catalog_skus.supply_availability
           FROM catalog_skus
           INNER JOIN catalog_releases
             ON catalog_releases.source_import_id = catalog_skus.import_id
           WHERE catalog_releases.id = ?
             AND catalog_releases.status = 'draft'
             ${selected.sql}
           ORDER BY catalog_skus.sku`,
        )
        .bind(releaseId, ...selected.bindings)
        .all<CandidateRow>();
      return result.results.map((row) => ({
        sku: row.sku,
        supplyAvailability: row.supply_availability,
      }));
    },

    async findDraftCatalogReview(releaseId, requestedFilters) {
      const release = await findDraftRelease(database, releaseId);
      if (!release) return null;
      const filters = normalizedFilters(requestedFilters);
      const filtered = filterClause(filters);
      const products = await database
        .prepare(
          `SELECT catalog_skus.sku, catalog_skus.source_worksheet,
                  catalog_skus.product_type, catalog_skus.hose_series,
                  catalog_skus.catalog_publication_status,
                  catalog_skus.rfq_eligibility,
                  catalog_skus.technical_data_status,
                  catalog_skus.supply_availability,
                  catalog_sales_offers.reference_price_usd,
                  catalog_cost_bases.currency AS cost_basis_currency,
                  catalog_cost_bases.factory_unit_price,
                  catalog_cost_bases.price_incoterm
           FROM catalog_skus
           LEFT JOIN catalog_sales_offers
             ON catalog_sales_offers.import_id = catalog_skus.import_id
            AND catalog_sales_offers.base_sku = catalog_skus.sku
           LEFT JOIN catalog_cost_bases
             ON catalog_cost_bases.import_id = catalog_sales_offers.import_id
            AND catalog_cost_bases.sales_sku = catalog_sales_offers.sales_sku
           WHERE catalog_skus.import_id = ?
             ${filtered.sql}
           ORDER BY catalog_skus.source_worksheet, catalog_skus.sku`,
        )
        .bind(release.source_import_id, ...filtered.bindings)
        .all<ProductRow>();
      const count = await database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM catalog_skus
           WHERE import_id = ? ${filtered.sql}`,
        )
        .bind(release.source_import_id, ...filtered.bindings)
        .first<{ count: number }>();
      const worksheetOptions = await database
        .prepare(
          `SELECT DISTINCT source_worksheet AS value
           FROM catalog_skus WHERE import_id = ? ORDER BY source_worksheet`,
        )
        .bind(release.source_import_id)
        .all<{ value: string }>();
      const hoseSeriesOptions = await database
        .prepare(
          `SELECT DISTINCT hose_series AS value
           FROM catalog_skus
           WHERE import_id = ? AND hose_series IS NOT NULL
           ORDER BY hose_series`,
        )
        .bind(release.source_import_id)
        .all<{ value: string }>();

      return {
        filters,
        hoseSeriesOptions: hoseSeriesOptions.results.map((row) => row.value),
        products: products.results.map(toProduct),
        release: {
          createdAt: release.created_at,
          id: release.id,
          releaseNumber: release.release_number,
          sourceImportId: release.source_import_id,
        },
        totalCount: count?.count ?? 0,
        worksheetOptions: worksheetOptions.results.map((row) => row.value),
      };
    },
  };
}
