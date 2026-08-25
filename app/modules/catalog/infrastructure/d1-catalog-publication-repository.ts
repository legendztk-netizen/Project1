import type {
  CatalogPublicationFinding,
  CatalogPublicationOperation,
  CatalogPublicationRelease,
  CatalogPublicationRepository,
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
  product_type: CatalogSkuDraft["productType"];
  release_id: string;
  release_number: string;
  rfq_eligibility: RfqEligibility;
  sku: string;
  supply_availability: SupplyAvailability;
  technical_data_status: TechnicalDataStatus;
}

export interface PublicCatalogProduct {
  canAddToQuote: boolean;
  catalogPublicationStatus: CatalogPublicationStatus;
  hoseSeries: string | null;
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
  { keyColumn: "base_sku", name: "catalog_sales_offers" },
] as const;

const relationshipTables = [
  {
    keyColumn: "series_code",
    label: "Hose Series",
    name: "catalog_hose_series",
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

  return new Map(
    [...fingerprints].map(([sku, value]) => [
      sku,
      JSON.stringify(canonicalValue(value)),
    ]),
  );
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
) {
  const additions = [...draft.keys()].filter((sku) => !active.has(sku));
  const deactivations = [...active.keys()].filter((sku) => !draft.has(sku));
  const changes = [...draft.keys()].filter(
    (sku) => active.has(sku) && active.get(sku) !== draft.get(sku),
  );
  return { additions, changes, deactivations };
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
                  catalog_skus.supply_availability
           FROM catalog_active_release
           INNER JOIN catalog_releases
             ON catalog_releases.id = catalog_active_release.release_id
           INNER JOIN catalog_skus
             ON catalog_skus.import_id = catalog_releases.source_import_id
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
                  catalog_skus.supply_availability
           FROM catalog_releases
           INNER JOIN catalog_skus
             ON catalog_skus.import_id = catalog_releases.source_import_id
           WHERE catalog_releases.id = ?
             AND catalog_releases.status IN ('published', 'superseded')
             AND catalog_skus.catalog_publication_status = 'Published'
             AND catalog_skus.sku = ?`,
        )
        .bind(releaseId, sku)
        .first<PublicCatalogProductRow>();
      return row ? publicProduct(row) : null;
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
        draftRelationships,
        activeRelationships,
      ] = await Promise.all([
        publicProductFingerprints(database, draft.source_import_id),
        publicProductFingerprints(
          database,
          activeRelease?.sourceImportId ?? null,
        ),
        relationshipFingerprints(database, draft.source_import_id),
        relationshipFingerprints(
          database,
          activeRelease?.sourceImportId ?? null,
        ),
      ]);
      const productDifferences = diffFingerprints(
        draftProducts,
        activeProducts,
      );
      const relationshipDifferences = diffFingerprints(
        draftRelationships,
        activeRelationships,
      );
      const differences = {
        additions: productDifferences.additions,
        changes: [
          ...productDifferences.changes,
          ...relationshipDifferences.additions,
          ...relationshipDifferences.changes,
          ...relationshipDifferences.deactivations,
        ],
        deactivations: productDifferences.deactivations,
      };
      return {
        activeGeneration: activeRow.active_generation,
        activeRelease,
        ...differences,
        blockers,
        draftRelease: releaseFromDraft(draft),
        warnings,
      };
    },

    async publish(operation: CatalogPublicationOperation) {
      const payload = JSON.stringify({
        previousReleaseId: operation.previousReleaseId,
        requestCorrelationId: operation.requestCorrelationId,
        ...operation.summary,
      });
      await database.batch([
        database
          .prepare(
            `INSERT INTO catalog_release_publications (
               release_id, previous_release_id, expected_active_version,
               expected_draft_version, published_by,
               request_correlation_id, published_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            operation.releaseId,
            operation.previousReleaseId,
            operation.expectedActiveGeneration,
            operation.expectedDraftVersion,
            operation.actorId,
            operation.requestCorrelationId,
            operation.publishedAt,
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
