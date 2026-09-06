import {
  calculateAssemblyImpact,
  type AssemblyImpactCompatibility,
  type AssemblyImpactProduct,
  type AssemblyImpactResult,
  type AssemblyImpactSnapshot,
  type AssemblyImpactSourceChange,
} from "../domain/catalog-assembly-impact";

export const assemblyDerivationRuleFingerprint =
  "assembly-component-combination-v1";

export interface CatalogAssemblyImpact extends AssemblyImpactResult {
  activeGeneration: number;
  baselineReleaseId: string | null;
  calculatedAt: string;
  calculatedBy: string;
  inputFingerprint: string;
  releaseId: string;
  status: "current" | "stale";
}

interface ReleaseComparisonRow {
  active_generation: number;
  baseline_release_id: string | null;
  baseline_source_import_id: string | null;
  draft_source_import_id: string;
}

interface ProductRow {
  derivation_fingerprint: string;
  hose_series: string | null;
  product_type: AssemblyImpactProduct["productType"];
  sku: string;
}

interface CompatibilityRow {
  compatibility_id: string;
  derivation_fingerprint: string;
  ferrule_sku: string;
  hose_end_sku: string;
  hose_sku: string;
}

interface PersistedImpactRow {
  active_generation: number;
  affected_series_json: string;
  baseline_release_id: string | null;
  calculated_at: string;
  calculated_by: string;
  input_fingerprint: string;
  release_id: string;
  shared_rule_fingerprint: string;
  source_changes_json: string;
  status: "current" | "stale";
}

function parseStringArray(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("Stored affected Assembly Series are invalid");
  }
  return parsed;
}

function parseSourceChanges(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Stored assembly impact source changes are invalid");
  }
  return parsed as AssemblyImpactSourceChange[];
}

function fromRow(row: PersistedImpactRow): CatalogAssemblyImpact {
  const affectedSeries = parseStringArray(row.affected_series_json);
  return {
    activeGeneration: row.active_generation,
    affectedSeries,
    baselineReleaseId: row.baseline_release_id,
    calculatedAt: row.calculated_at,
    calculatedBy: row.calculated_by,
    inputFingerprint: row.input_fingerprint,
    releaseId: row.release_id,
    sourceChanges: parseSourceChanges(row.source_changes_json),
    stale: row.status === "stale",
    status: row.status,
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function findComparison(
  database: D1Database,
  releaseId: string,
): Promise<ReleaseComparisonRow | null> {
  return database
    .prepare(
      `SELECT active.version AS active_generation,
              baseline.id AS baseline_release_id,
              baseline.source_import_id AS baseline_source_import_id,
              draft.source_import_id AS draft_source_import_id
       FROM catalog_releases draft
       INNER JOIN catalog_imports source_import
         ON source_import.id = draft.source_import_id
       INNER JOIN catalog_active_release active ON active.singleton = 1
       LEFT JOIN catalog_releases baseline ON baseline.id = active.release_id
       WHERE draft.id = ?
         AND draft.status = 'draft'
         AND source_import.kind = 'workbook'
         AND source_import.status = 'completed'`,
    )
    .bind(releaseId)
    .first<ReleaseComparisonRow>();
}

async function findProducts(database: D1Database, importId: string | null) {
  if (!importId) return [];
  const rows = await database
    .prepare(
      `SELECT product.sku, product.product_type, product.hose_series,
              json_object(
                'productType', product.product_type,
                'hoseSeries', product.hose_series,
                'catalogPublicationStatus', product.catalog_publication_status,
                'rfqEligibility', product.rfq_eligibility,
                'supplyAvailability', product.supply_availability,
                'hasHoseDetail', hose.sku IS NOT NULL,
                'hasHoseEndDetail', hose_end.sku IS NOT NULL,
                'hasFerruleDetail', ferrule.sku IS NOT NULL
              ) AS derivation_fingerprint
       FROM catalog_skus product
       LEFT JOIN catalog_hose_variants hose
         ON hose.import_id = product.import_id AND hose.sku = product.sku
       LEFT JOIN catalog_hose_ends hose_end
         ON hose_end.import_id = product.import_id AND hose_end.sku = product.sku
       LEFT JOIN catalog_ferrules ferrule
         ON ferrule.import_id = product.import_id AND ferrule.sku = product.sku
       WHERE product.import_id = ?
         AND product.product_type IN ('hose', 'hose_end', 'ferrule')
       ORDER BY product.sku`,
    )
    .bind(importId)
    .all<ProductRow>();
  return rows.results.map((row): AssemblyImpactProduct => ({
    derivationFingerprint: row.derivation_fingerprint,
    hoseSeries: row.hose_series,
    productType: row.product_type,
    sku: row.sku,
  }));
}

async function findCompatibilities(
  database: D1Database,
  importId: string | null,
) {
  if (!importId) return [];
  const rows = await database
    .prepare(
      `SELECT relationship.compatibility_id, relationship.hose_sku,
              relationship.hose_end_sku, relationship.ferrule_sku,
              json_object(
                'hoseSku', relationship.hose_sku,
                'hoseEndSku', relationship.hose_end_sku,
                'ferruleSku', relationship.ferrule_sku,
                'catalogPublicationStatus', relationship.catalog_publication_status,
                'rfqEligibility', relationship.rfq_eligibility,
                'technicalDataStatus', relationship.technical_data_status,
                'assemblyMethod', relationship.assembly_method,
                'skiveRequirement', relationship.skive_requirement,
                'outerSkiveLengthMm', relationship.outer_skive_length_mm,
                'innerSkiveLengthMm', relationship.inner_skive_length_mm,
                'insertionDepthMm', relationship.insertion_depth_mm,
                'crimpProgram', relationship.crimp_program,
                'finalCrimpDiameterMm', relationship.final_crimp_diameter_mm,
                'toleranceMm', relationship.tolerance_mm,
                'measurementLocation', relationship.measurement_location,
                'assemblyWorkingBar', relationship.assembly_working_bar,
                'proofPressureBar', relationship.proof_pressure_bar,
                'proofHoldSeconds', relationship.proof_hold_seconds,
                'qualificationId', relationship.qualification_id,
                'qualificationStatus', relationship.qualification_status
              ) AS derivation_fingerprint
       FROM catalog_compatibilities relationship
       WHERE relationship.import_id = ?
       ORDER BY relationship.compatibility_id`,
    )
    .bind(importId)
    .all<CompatibilityRow>();
  return rows.results.map((row): AssemblyImpactCompatibility => ({
    compatibilityId: row.compatibility_id,
    derivationFingerprint: row.derivation_fingerprint,
    ferruleSku: row.ferrule_sku,
    hoseEndSku: row.hose_end_sku,
    hoseSku: row.hose_sku,
  }));
}

async function snapshot(
  database: D1Database,
  importId: string | null,
  sharedDerivationRuleFingerprint: string,
): Promise<AssemblyImpactSnapshot> {
  const [products, compatibilities] = await Promise.all([
    findProducts(database, importId),
    findCompatibilities(database, importId),
  ]);
  return {
    compatibilities,
    products,
    sharedDerivationRuleFingerprint,
  };
}

async function persistedRuleFingerprint(
  database: D1Database,
  releaseId: string | null,
) {
  if (!releaseId) return assemblyDerivationRuleFingerprint;
  const coverage = await database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM (
            SELECT DISTINCT hose.hose_series
            FROM catalog_releases release
            INNER JOIN catalog_skus hose
              ON hose.import_id = release.source_import_id
            WHERE release.id = ? AND hose.product_type = 'hose'
              AND hose.hose_series IS NOT NULL
          )) AS expected_count,
         (SELECT COUNT(*) FROM catalog_derived_assembly_series
          WHERE release_id = ?) AS generated_count`,
    )
    .bind(releaseId, releaseId)
    .first<{ expected_count: number; generated_count: number }>();
  if (
    (coverage?.expected_count ?? 0) > 0 &&
    coverage?.generated_count !== coverage?.expected_count
  ) {
    return "missing-derived-assembly-data";
  }
  const row = await database
    .prepare(
      `SELECT shared_rule_fingerprint
       FROM catalog_assembly_impact_analyses WHERE release_id = ?`,
    )
    .bind(releaseId)
    .first<{ shared_rule_fingerprint: string }>();
  return row?.shared_rule_fingerprint ?? assemblyDerivationRuleFingerprint;
}

export function createD1CatalogAssemblyImpactRepository(database: D1Database) {
  return {
    async find(releaseId: string): Promise<CatalogAssemblyImpact | null> {
      const row = await database
        .prepare(
          `SELECT release_id, baseline_release_id, active_generation,
                  shared_rule_fingerprint, input_fingerprint,
                  affected_series_json, source_changes_json, status,
                  calculated_at, calculated_by
           FROM catalog_assembly_impact_analyses WHERE release_id = ?`,
        )
        .bind(releaseId)
        .first<PersistedImpactRow>();
      return row ? fromRow(row) : null;
    },

    async recalculate(input: {
      actorId: string;
      generateId?: () => string;
      ipAddress: string;
      now?: () => Date;
      releaseId: string;
      requestCorrelationId: string;
    }): Promise<CatalogAssemblyImpact | null> {
      const comparison = await findComparison(database, input.releaseId);
      if (!comparison) return null;
      const baselineRule = await persistedRuleFingerprint(
        database,
        comparison.baseline_release_id,
      );
      const [before, after] = await Promise.all([
        snapshot(database, comparison.baseline_source_import_id, baselineRule),
        snapshot(
          database,
          comparison.draft_source_import_id,
          assemblyDerivationRuleFingerprint,
        ),
      ]);
      const calculated = calculateAssemblyImpact(before, after);
      const inputFingerprint = await sha256(calculated.inputFingerprint);
      const existing = await this.find(input.releaseId);
      if (
        existing?.inputFingerprint === inputFingerprint &&
        existing.activeGeneration === comparison.active_generation &&
        existing.baselineReleaseId === comparison.baseline_release_id
      ) {
        return existing;
      }

      const calculationId = (input.generateId ?? (() => crypto.randomUUID()))();
      const calculatedAt = (input.now ?? (() => new Date()))().toISOString();
      const status = calculated.stale ? "stale" : "current";
      const affectedSeriesJson = JSON.stringify(calculated.affectedSeries);
      const sourceChangesJson = JSON.stringify(calculated.sourceChanges);
      const auditPayload = JSON.stringify({
        activeGeneration: comparison.active_generation,
        affectedSeries: calculated.affectedSeries,
        after: {
          activeGeneration: comparison.active_generation,
          affectedSeries: calculated.affectedSeries,
          baselineReleaseId: comparison.baseline_release_id,
          inputFingerprint,
          sourceChanges: calculated.sourceChanges,
          status,
        },
        baselineReleaseId: comparison.baseline_release_id,
        before: existing,
        inputFingerprint,
        ipAddress: input.ipAddress,
        requestCorrelationId: input.requestCorrelationId,
        sourceChanges: calculated.sourceChanges,
        status,
      });

      await database.batch([
        database
          .prepare(
            `INSERT INTO catalog_assembly_impact_analyses (
               release_id, baseline_release_id, active_generation,
               shared_rule_fingerprint, input_fingerprint,
               affected_series_json, source_changes_json, status,
               calculated_at, calculated_by, last_calculation_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(release_id) DO UPDATE SET
               baseline_release_id = excluded.baseline_release_id,
               active_generation = excluded.active_generation,
               shared_rule_fingerprint = excluded.shared_rule_fingerprint,
               input_fingerprint = excluded.input_fingerprint,
               affected_series_json = excluded.affected_series_json,
               source_changes_json = excluded.source_changes_json,
               status = excluded.status,
               calculated_at = excluded.calculated_at,
               calculated_by = excluded.calculated_by,
               last_calculation_id = excluded.last_calculation_id`,
          )
          .bind(
            input.releaseId,
            comparison.baseline_release_id,
            comparison.active_generation,
            assemblyDerivationRuleFingerprint,
            inputFingerprint,
            affectedSeriesJson,
            sourceChangesJson,
            status,
            calculatedAt,
            input.actorId,
            calculationId,
          ),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id,
               actor_id, payload_json, occurred_at
             ) VALUES (?, 'catalog_release.assembly_impact_calculated',
                       'catalog_release', ?, ?, ?, ?)`,
          )
          .bind(
            calculationId,
            input.releaseId,
            input.actorId,
            auditPayload,
            calculatedAt,
          ),
      ]);
      return {
        activeGeneration: comparison.active_generation,
        affectedSeries: calculated.affectedSeries,
        baselineReleaseId: comparison.baseline_release_id,
        calculatedAt,
        calculatedBy: input.actorId,
        inputFingerprint,
        releaseId: input.releaseId,
        sourceChanges: calculated.sourceChanges,
        stale: calculated.stale,
        status,
      };
    },
  };
}
