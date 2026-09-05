import type {
  AssemblyRegenerationOperation,
  AssemblyRegenerationPlan,
  AssemblyRegenerationRepository,
  DerivedAssemblyCombination,
  DerivedAssemblyEndpoint,
} from "../domain/catalog-assembly-regeneration";

interface PlanRow {
  affected_series_json: string;
  baseline_release_id: string | null;
  input_fingerprint: string;
  source_import_id: string;
  status: "current" | "stale";
}

interface EndpointRow {
  compatibility_id: string;
  ferrule_sku: string;
  hose_end_sku: string;
  hose_series: string;
  hose_sku: string;
  relationship_fingerprint: string;
}

interface CombinationRow {
  combination_fingerprint: string;
  end_a_compatibility_id: string;
  end_a_ferrule_sku: string;
  end_a_hose_end_sku: string;
  end_a_relationship_fingerprint: string;
  end_b_compatibility_id: string;
  end_b_ferrule_sku: string;
  end_b_hose_end_sku: string;
  end_b_relationship_fingerprint: string;
  hose_series: string;
  hose_sku: string;
}

const relationshipFingerprintSql = `json_object(
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
)`;

function parseSeries(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("Affected Assembly Series are invalid");
  }
  return [...new Set(parsed)].sort((left, right) => left.localeCompare(right));
}

function endpoint(row: EndpointRow): DerivedAssemblyEndpoint {
  return {
    compatibilityId: row.compatibility_id,
    ferruleSku: row.ferrule_sku,
    hoseEndSku: row.hose_end_sku,
    hoseSeries: row.hose_series,
    hoseSku: row.hose_sku,
    relationshipFingerprint: row.relationship_fingerprint,
  };
}

function combination(row: CombinationRow): DerivedAssemblyCombination {
  return {
    combinationFingerprint: row.combination_fingerprint,
    endACompatibilityId: row.end_a_compatibility_id,
    endAFerruleSku: row.end_a_ferrule_sku,
    endAHoseEndSku: row.end_a_hose_end_sku,
    endARelationshipFingerprint: row.end_a_relationship_fingerprint,
    endBCompatibilityId: row.end_b_compatibility_id,
    endBFerruleSku: row.end_b_ferrule_sku,
    endBHoseEndSku: row.end_b_hose_end_sku,
    endBRelationshipFingerprint: row.end_b_relationship_fingerprint,
    hoseSeries: row.hose_series,
    hoseSku: row.hose_sku,
    identityKey: JSON.stringify([
      row.hose_sku,
      row.end_a_compatibility_id,
      row.end_b_compatibility_id,
    ]),
  };
}

async function findEndpoints(
  database: D1Database,
  releaseId: string,
  affectedSeriesJson: string,
) {
  const rows = await database
    .prepare(
      `SELECT relationship.compatibility_id, relationship.hose_sku,
              relationship.hose_end_sku, relationship.ferrule_sku,
              hose.hose_series,
              ${relationshipFingerprintSql} AS relationship_fingerprint
       FROM catalog_releases release
       INNER JOIN catalog_compatibilities relationship
         ON relationship.import_id = release.source_import_id
       INNER JOIN catalog_skus hose
         ON hose.import_id = relationship.import_id
        AND hose.sku = relationship.hose_sku
       INNER JOIN catalog_hose_variants hose_detail
         ON hose_detail.import_id = hose.import_id AND hose_detail.sku = hose.sku
       INNER JOIN catalog_skus hose_end
         ON hose_end.import_id = relationship.import_id
        AND hose_end.sku = relationship.hose_end_sku
       INNER JOIN catalog_hose_ends hose_end_detail
         ON hose_end_detail.import_id = hose_end.import_id
        AND hose_end_detail.sku = hose_end.sku
       INNER JOIN catalog_skus ferrule
         ON ferrule.import_id = relationship.import_id
        AND ferrule.sku = relationship.ferrule_sku
       INNER JOIN catalog_ferrules ferrule_detail
         ON ferrule_detail.import_id = ferrule.import_id
        AND ferrule_detail.sku = ferrule.sku
       WHERE release.id = ? AND release.status = 'draft'
         AND hose.hose_series IN (SELECT value FROM json_each(?))
         AND relationship.catalog_publication_status = 'Published'
         AND relationship.rfq_eligibility = 'Eligible'
         AND hose.product_type = 'hose'
         AND hose.catalog_publication_status = 'Published'
         AND hose.rfq_eligibility = 'Eligible'
         AND hose.supply_availability = 'available_for_quote'
         AND hose_end.product_type = 'hose_end'
         AND hose_end.catalog_publication_status = 'Published'
         AND hose_end.rfq_eligibility = 'Eligible'
         AND hose_end.supply_availability = 'available_for_quote'
         AND ferrule.product_type = 'ferrule'
         AND ferrule.catalog_publication_status = 'Published'
         AND ferrule.rfq_eligibility = 'Eligible'
         AND ferrule.supply_availability = 'available_for_quote'
       ORDER BY hose.sku, relationship.compatibility_id`,
    )
    .bind(releaseId, affectedSeriesJson)
    .all<EndpointRow>();
  return rows.results.map(endpoint);
}

async function findCombinations(
  database: D1Database,
  releaseId: string | null,
  seriesJson: string,
) {
  if (!releaseId) return [];
  const rows = await database
    .prepare(
      `SELECT hose_series, hose_sku,
              end_a_compatibility_id, end_a_hose_end_sku,
              end_a_ferrule_sku, end_a_relationship_fingerprint,
              end_b_compatibility_id, end_b_hose_end_sku,
              end_b_ferrule_sku, end_b_relationship_fingerprint,
              combination_fingerprint
       FROM catalog_derived_assembly_combinations
       WHERE release_id = ?
         AND hose_series IN (SELECT value FROM json_each(?))
       ORDER BY hose_sku, end_a_compatibility_id, end_b_compatibility_id`,
    )
    .bind(releaseId, seriesJson)
    .all<CombinationRow>();
  return rows.results.map(combination);
}

async function missingDraftSeries(
  database: D1Database,
  releaseId: string,
  series: readonly string[],
) {
  if (series.length === 0) return [];
  const rows = await database
    .prepare(
      `SELECT value AS hose_series
       FROM json_each(?) requested
       WHERE NOT EXISTS (
         SELECT 1 FROM catalog_derived_assembly_series generated
         WHERE generated.release_id = ?
           AND generated.hose_series = requested.value
       )`,
    )
    .bind(JSON.stringify(series), releaseId)
    .all<{ hose_series: string }>();
  return rows.results.map((row) => row.hose_series);
}

function attemptStatements(
  database: D1Database,
  input: {
    actorId: string;
    affectedSeries: string[];
    attemptId: string;
    error?: string;
    inputFingerprint: string;
    ipAddress: string;
    occurredAt: string;
    releaseId: string;
    requestCorrelationId: string;
    status: "already_current" | "failed";
  },
) {
  const event =
    input.status === "failed"
      ? "catalog_release.assembly_regeneration_failed"
      : "catalog_release.assembly_regeneration_already_current";
  const payload = JSON.stringify({
    affectedSeries: input.affectedSeries,
    error: input.error,
    inputFingerprint: input.inputFingerprint,
    ipAddress: input.ipAddress,
    requestCorrelationId: input.requestCorrelationId,
    status: input.status,
  });
  return [
    database
      .prepare(
        `INSERT INTO catalog_assembly_regenerations (
           id, release_id, input_fingerprint, affected_series_json, status,
           actor_id, occurred_at, error_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.attemptId,
        input.releaseId,
        input.inputFingerprint,
        JSON.stringify(input.affectedSeries),
        input.status,
        input.actorId,
        input.occurredAt,
        input.error ? JSON.stringify({ message: input.error }) : null,
      ),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, ?, 'catalog_release', ?, ?, ?, ?)`,
      )
      .bind(
        `${input.attemptId}:audit`,
        event,
        input.releaseId,
        input.actorId,
        payload,
        input.occurredAt,
      ),
  ];
}

export function createD1CatalogAssemblyRegenerationRepository(
  database: D1Database,
): AssemblyRegenerationRepository {
  return {
    async findPlan(releaseId): Promise<AssemblyRegenerationPlan | null> {
      const row = await database
        .prepare(
          `SELECT release.source_import_id, impact.baseline_release_id,
                  impact.input_fingerprint, impact.affected_series_json,
                  impact.status
           FROM catalog_releases release
           INNER JOIN catalog_assembly_impact_analyses impact
             ON impact.release_id = release.id
           WHERE release.id = ? AND release.status = 'draft'`,
        )
        .bind(releaseId)
        .first<PlanRow>();
      if (!row) return null;
      const affectedSeries = parseSeries(row.affected_series_json);
      const affectedSeriesJson = JSON.stringify(affectedSeries);
      const allSeriesRows = await database
        .prepare(
          `SELECT DISTINCT hose_series
           FROM catalog_skus
           WHERE import_id = ? AND product_type = 'hose'
             AND hose_series IS NOT NULL
           ORDER BY hose_series`,
        )
        .bind(row.source_import_id)
        .all<{ hose_series: string }>();
      const missing = await missingDraftSeries(
        database,
        releaseId,
        affectedSeries,
      );
      const [draftBefore, baselineBefore, endpoints] = await Promise.all([
        findCombinations(database, releaseId, affectedSeriesJson),
        findCombinations(
          database,
          row.baseline_release_id,
          JSON.stringify(missing),
        ),
        findEndpoints(database, releaseId, affectedSeriesJson),
      ]);
      return {
        affectedSeries,
        allDraftSeries: allSeriesRows.results.map((item) => item.hose_series),
        baselineReleaseId: row.baseline_release_id,
        beforeAffectedCombinations: [...draftBefore, ...baselineBefore],
        endpoints,
        inputFingerprint: row.input_fingerprint,
        releaseId,
        sourceImportId: row.source_import_id,
        status: row.status,
      };
    },

    async recordAlreadyCurrent(input) {
      await database.batch(
        attemptStatements(database, {
          ...input,
          affectedSeries: [],
          status: "already_current",
        }),
      );
    },

    async recordFailure(input) {
      await database.batch(
        attemptStatements(database, { ...input, status: "failed" }),
      );
    },

    async regenerate(operation: AssemblyRegenerationOperation) {
      const affectedSeriesJson = JSON.stringify(operation.affectedSeries);
      const auditPayload = JSON.stringify({
        additionCount: operation.additionCount,
        affectedSeries: operation.affectedSeries,
        changeCount: operation.changeCount,
        combinationCount: operation.combinationCount,
        inputFingerprint: operation.inputFingerprint,
        ipAddress: operation.ipAddress,
        removalCount: operation.removalCount,
        requestCorrelationId: operation.requestCorrelationId,
        status: operation.status,
      });
      await database.batch([
        database
          .prepare(
            `DELETE FROM catalog_derived_assembly_series
             WHERE release_id = ?
               AND hose_series IN (SELECT value FROM json_each(?))`,
          )
          .bind(operation.releaseId, affectedSeriesJson),
        database
          .prepare(
            `INSERT INTO catalog_derived_assembly_series (
               release_id, source_import_id, hose_series, generation_id,
               input_fingerprint, combination_count, generated_at, generated_by
             )
             SELECT ?, ?, active_series.hose_series,
                    active_series.generation_id, active_series.input_fingerprint,
                    active_series.combination_count, active_series.generated_at,
                    active_series.generated_by
             FROM catalog_derived_assembly_series active_series
             INNER JOIN catalog_assembly_impact_analyses impact
               ON impact.release_id = ?
             WHERE active_series.release_id = impact.baseline_release_id
               AND active_series.hose_series NOT IN (
                 SELECT value FROM json_each(?)
               )
               AND EXISTS (
                 SELECT 1 FROM catalog_skus hose
                 WHERE hose.import_id = ? AND hose.product_type = 'hose'
                   AND hose.hose_series = active_series.hose_series
               )
               AND NOT EXISTS (
                 SELECT 1 FROM catalog_derived_assembly_series existing
                 WHERE existing.release_id = ?
                   AND existing.hose_series = active_series.hose_series
               )`,
          )
          .bind(
            operation.releaseId,
            operation.sourceImportId,
            operation.releaseId,
            affectedSeriesJson,
            operation.sourceImportId,
            operation.releaseId,
          ),
        database
          .prepare(
            `INSERT INTO catalog_derived_assembly_combinations (
               id, release_id, source_import_id, hose_series, hose_sku,
               end_a_compatibility_id, end_a_hose_end_sku, end_a_ferrule_sku,
               end_b_compatibility_id, end_b_hose_end_sku, end_b_ferrule_sku,
               end_a_relationship_fingerprint, end_b_relationship_fingerprint,
               combination_fingerprint, generated_at
             )
             SELECT lower(hex(randomblob(16))), ?, ?, active.hose_series,
                    active.hose_sku, active.end_a_compatibility_id,
                    active.end_a_hose_end_sku, active.end_a_ferrule_sku,
                    active.end_b_compatibility_id, active.end_b_hose_end_sku,
                    active.end_b_ferrule_sku,
                    active.end_a_relationship_fingerprint,
                    active.end_b_relationship_fingerprint,
                    active.combination_fingerprint, active.generated_at
             FROM catalog_derived_assembly_combinations active
             INNER JOIN catalog_assembly_impact_analyses impact
               ON impact.release_id = ?
             INNER JOIN catalog_derived_assembly_series target_series
               ON target_series.release_id = ?
              AND target_series.hose_series = active.hose_series
             WHERE active.release_id = impact.baseline_release_id
               AND active.hose_series NOT IN (
                 SELECT value FROM json_each(?)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM catalog_derived_assembly_combinations existing
                 WHERE existing.release_id = ?
                   AND existing.hose_sku = active.hose_sku
                   AND existing.end_a_compatibility_id = active.end_a_compatibility_id
                   AND existing.end_b_compatibility_id = active.end_b_compatibility_id
               )`,
          )
          .bind(
            operation.releaseId,
            operation.sourceImportId,
            operation.releaseId,
            operation.releaseId,
            affectedSeriesJson,
            operation.releaseId,
          ),
        database
          .prepare(
            `INSERT INTO catalog_derived_assembly_series (
               release_id, source_import_id, hose_series, generation_id,
               input_fingerprint, combination_count, generated_at, generated_by
             )
             SELECT ?, ?, requested.value, ?, ?, 0, ?, ?
             FROM json_each(?) requested
             INNER JOIN catalog_skus hose
               ON hose.import_id = ? AND hose.product_type = 'hose'
              AND hose.hose_series = requested.value
             WHERE hose.hose_series IS NOT NULL
             GROUP BY requested.value`,
          )
          .bind(
            operation.releaseId,
            operation.sourceImportId,
            operation.generationId,
            operation.inputFingerprint,
            operation.occurredAt,
            operation.actorId,
            JSON.stringify(operation.generatedSeries),
            operation.sourceImportId,
          ),
        database
          .prepare(
            `INSERT INTO catalog_derived_assembly_combinations (
               id, release_id, source_import_id, hose_series, hose_sku,
               end_a_compatibility_id, end_a_hose_end_sku, end_a_ferrule_sku,
               end_b_compatibility_id, end_b_hose_end_sku, end_b_ferrule_sku,
               end_a_relationship_fingerprint, end_b_relationship_fingerprint,
               combination_fingerprint, generated_at
             )
             SELECT lower(hex(randomblob(16))), ?, ?, hose.hose_series, hose.sku,
                    end_a.compatibility_id, end_a.hose_end_sku, end_a.ferrule_sku,
                    end_b.compatibility_id, end_b.hose_end_sku, end_b.ferrule_sku,
                    ${relationshipFingerprintSql.replaceAll("relationship.", "end_a.")},
                    ${relationshipFingerprintSql.replaceAll("relationship.", "end_b.")},
                    json_array(
                      json_array(hose.sku, end_a.compatibility_id, end_b.compatibility_id) || '',
                      ${relationshipFingerprintSql.replaceAll("relationship.", "end_a.")} || '',
                      ${relationshipFingerprintSql.replaceAll("relationship.", "end_b.")} || ''
                    ), ?
             FROM catalog_skus hose
             INNER JOIN catalog_hose_variants hose_detail
               ON hose_detail.import_id = hose.import_id AND hose_detail.sku = hose.sku
             INNER JOIN catalog_compatibilities end_a
               ON end_a.import_id = hose.import_id AND end_a.hose_sku = hose.sku
             INNER JOIN catalog_compatibilities end_b
               ON end_b.import_id = hose.import_id AND end_b.hose_sku = hose.sku
             INNER JOIN catalog_skus end_a_sku
               ON end_a_sku.import_id = end_a.import_id
              AND end_a_sku.sku = end_a.hose_end_sku
             INNER JOIN catalog_hose_ends end_a_detail
               ON end_a_detail.import_id = end_a_sku.import_id
              AND end_a_detail.sku = end_a_sku.sku
             INNER JOIN catalog_skus end_a_ferrule
               ON end_a_ferrule.import_id = end_a.import_id
              AND end_a_ferrule.sku = end_a.ferrule_sku
             INNER JOIN catalog_ferrules end_a_ferrule_detail
               ON end_a_ferrule_detail.import_id = end_a_ferrule.import_id
              AND end_a_ferrule_detail.sku = end_a_ferrule.sku
             INNER JOIN catalog_skus end_b_sku
               ON end_b_sku.import_id = end_b.import_id
              AND end_b_sku.sku = end_b.hose_end_sku
             INNER JOIN catalog_hose_ends end_b_detail
               ON end_b_detail.import_id = end_b_sku.import_id
              AND end_b_detail.sku = end_b_sku.sku
             INNER JOIN catalog_skus end_b_ferrule
               ON end_b_ferrule.import_id = end_b.import_id
              AND end_b_ferrule.sku = end_b.ferrule_sku
             INNER JOIN catalog_ferrules end_b_ferrule_detail
               ON end_b_ferrule_detail.import_id = end_b_ferrule.import_id
              AND end_b_ferrule_detail.sku = end_b_ferrule.sku
             WHERE hose.import_id = ? AND hose.product_type = 'hose'
               AND hose.hose_series IN (SELECT value FROM json_each(?))
               AND hose.catalog_publication_status = 'Published'
               AND hose.rfq_eligibility = 'Eligible'
               AND hose.supply_availability = 'available_for_quote'
               AND end_a.catalog_publication_status = 'Published'
               AND end_a.rfq_eligibility = 'Eligible'
               AND end_b.catalog_publication_status = 'Published'
               AND end_b.rfq_eligibility = 'Eligible'
               AND end_a_sku.product_type = 'hose_end'
               AND end_a_sku.catalog_publication_status = 'Published'
               AND end_a_sku.rfq_eligibility = 'Eligible'
               AND end_a_sku.supply_availability = 'available_for_quote'
               AND end_a_ferrule.product_type = 'ferrule'
               AND end_a_ferrule.catalog_publication_status = 'Published'
               AND end_a_ferrule.rfq_eligibility = 'Eligible'
               AND end_a_ferrule.supply_availability = 'available_for_quote'
               AND end_b_sku.product_type = 'hose_end'
               AND end_b_sku.catalog_publication_status = 'Published'
               AND end_b_sku.rfq_eligibility = 'Eligible'
               AND end_b_sku.supply_availability = 'available_for_quote'
               AND end_b_ferrule.product_type = 'ferrule'
               AND end_b_ferrule.catalog_publication_status = 'Published'
               AND end_b_ferrule.rfq_eligibility = 'Eligible'
               AND end_b_ferrule.supply_availability = 'available_for_quote'`,
          )
          .bind(
            operation.releaseId,
            operation.sourceImportId,
            operation.occurredAt,
            operation.sourceImportId,
            affectedSeriesJson,
          ),
        database
          .prepare(
            `UPDATE catalog_derived_assembly_series
             SET combination_count = (
               SELECT COUNT(*)
               FROM catalog_derived_assembly_combinations combination
               WHERE combination.release_id = catalog_derived_assembly_series.release_id
                 AND combination.hose_series = catalog_derived_assembly_series.hose_series
             )
             WHERE release_id = ? AND generation_id = ?
               AND hose_series IN (SELECT value FROM json_each(?))`,
          )
          .bind(
            operation.releaseId,
            operation.generationId,
            affectedSeriesJson,
          ),
        database
          .prepare(
            `INSERT INTO catalog_assembly_regenerations (
               id, release_id, input_fingerprint, affected_series_json, status,
               addition_count, change_count, removal_count, combination_count,
               actor_id, occurred_at
             ) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            operation.generationId,
            operation.releaseId,
            operation.inputFingerprint,
            affectedSeriesJson,
            operation.additionCount,
            operation.changeCount,
            operation.removalCount,
            operation.combinationCount,
            operation.actorId,
            operation.occurredAt,
          ),
        database
          .prepare(
            `UPDATE catalog_assembly_impact_analyses
             SET status = 'current'
             WHERE release_id = ? AND status = 'stale'
               AND input_fingerprint = ?`,
          )
          .bind(operation.releaseId, operation.inputFingerprint),
        database
          .prepare(
            `INSERT INTO admin_audit_events (
               id, event_type, entity_type, entity_id,
               actor_id, payload_json, occurred_at
             ) VALUES (?, 'catalog_release.assembly_regenerated',
                       'catalog_release', ?, ?, ?, ?)`,
          )
          .bind(
            `${operation.generationId}:audit`,
            operation.releaseId,
            operation.actorId,
            auditPayload,
            operation.occurredAt,
          ),
      ]);
    },
  };
}
