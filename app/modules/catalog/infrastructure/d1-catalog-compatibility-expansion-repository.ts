interface CompatibilityExpansionRelease {
  active_import_id: string | null;
  draft_import_id: string;
}

interface SkuRow {
  sku: string;
}

interface AutomaticRelationshipRow {
  catalogPublicationStatus: string;
  compatibilityId: string;
  ferruleSku: string;
  hoseEndSku: string;
  hoseSku: string;
  productionApprovalStatus: string;
  qualificationStatus: string;
  referenceSystem: string;
  rfqEligibility: string;
  skiveRequirement: string;
  technicalDataStatus: string;
}

export interface CatalogCompatibilityExpansionResult {
  addedCount: number;
  affectedSkus: string[];
  removedCount: number;
}

async function changedSkus(
  database: D1Database,
  draftImportId: string,
  activeImportId: string | null,
  productType: "ferrule" | "hose" | "hose_end",
) {
  const details = {
    ferrule: {
      activeTable: "catalog_ferrules",
      comparison: `draft_detail.ferrule_series IS NOT active_detail.ferrule_series
        OR draft_detail.hose_tail_dash IS NOT active_detail.hose_tail_dash
        OR draft_detail.skive_requirement IS NOT active_detail.skive_requirement`,
      table: "catalog_ferrules",
    },
    hose: {
      activeTable: "catalog_hose_variants",
      comparison: `draft_detail.hose_series IS NOT active_detail.hose_series
        OR draft_detail.dash IS NOT active_detail.dash
        OR draft_detail.skive_requirement IS NOT active_detail.skive_requirement`,
      table: "catalog_hose_variants",
    },
    hose_end: {
      activeTable: "catalog_hose_ends",
      comparison:
        "draft_detail.hose_tail_dash IS NOT active_detail.hose_tail_dash",
      table: "catalog_hose_ends",
    },
  }[productType];
  const rows = await database
    .prepare(
      `SELECT draft_product.sku
       FROM catalog_skus draft_product
       INNER JOIN ${details.table} draft_detail
         ON draft_detail.import_id = draft_product.import_id
        AND draft_detail.sku = draft_product.sku
       LEFT JOIN catalog_skus active_product
         ON active_product.import_id = ?2
        AND active_product.sku = draft_product.sku
        AND active_product.product_type = draft_product.product_type
       LEFT JOIN ${details.activeTable} active_detail
         ON active_detail.import_id = active_product.import_id
        AND active_detail.sku = active_product.sku
       WHERE draft_product.import_id = ?1
         AND draft_product.product_type = ?3
         AND (
           active_product.sku IS NULL
           OR ${details.comparison}
           OR draft_product.catalog_publication_status IS NOT active_product.catalog_publication_status
           OR draft_product.rfq_eligibility IS NOT active_product.rfq_eligibility
           OR draft_product.supply_availability IS NOT active_product.supply_availability
         )
       ORDER BY draft_product.sku`,
    )
    .bind(draftImportId, activeImportId, productType)
    .all<SkuRow>();
  return rows.results.map((row) => row.sku);
}

/**
 * Rebuilds only relationships touched by changed Hose, Hose End, or Ferrule
 * compatibility keys. The rule is deterministic:
 *
 * - Hose End hose_tail_dash = Hose dash
 * - Ferrule ferrule_series = Hose hose_series
 * - Ferrule hose_tail_dash = Hose dash
 * - Ferrule skive_requirement = Hose skive_requirement
 *
 * Product lifecycle still gates whether a tuple can be customer-facing.
 */
export async function expandDraftCatalogCompatibilities(
  database: D1Database,
  input: {
    actorId: string;
    ipAddress: string;
    releaseId: string;
    requestCorrelationId: string;
  },
): Promise<CatalogCompatibilityExpansionResult | null> {
  const release = await database
    .prepare(
      `SELECT draft.source_import_id AS draft_import_id,
              active_release.source_import_id AS active_import_id
       FROM catalog_releases draft
       INNER JOIN catalog_imports source_import
         ON source_import.id = draft.source_import_id
        AND source_import.status = 'completed'
       LEFT JOIN catalog_active_release pointer ON pointer.singleton = 1
       LEFT JOIN catalog_releases active_release
         ON active_release.id = pointer.release_id
       WHERE draft.id = ? AND draft.status = 'draft'`,
    )
    .bind(input.releaseId)
    .first<CompatibilityExpansionRelease>();
  if (!release) return null;

  const [hoseSkus, hoseEndSkus, ferruleSkus] = await Promise.all([
    changedSkus(
      database,
      release.draft_import_id,
      release.active_import_id,
      "hose",
    ),
    changedSkus(
      database,
      release.draft_import_id,
      release.active_import_id,
      "hose_end",
    ),
    changedSkus(
      database,
      release.draft_import_id,
      release.active_import_id,
      "ferrule",
    ),
  ]);
  const affectedSkus = [
    ...new Set([...hoseSkus, ...hoseEndSkus, ...ferruleSkus]),
  ].sort();
  if (affectedSkus.length === 0) {
    return { addedCount: 0, affectedSkus: [], removedCount: 0 };
  }

  const occurredAt = new Date().toISOString();
  const auditEventId = `catalog-compatibility-expanded:${crypto.randomUUID()}`;
  const beforeRelationships = await database
    .prepare(
      `SELECT compatibility_id AS compatibilityId, hose_sku AS hoseSku,
              hose_end_sku AS hoseEndSku, ferrule_sku AS ferruleSku,
              catalog_publication_status AS catalogPublicationStatus,
              skive_requirement AS skiveRequirement,
              rfq_eligibility AS rfqEligibility,
              technical_data_status AS technicalDataStatus,
              qualification_status AS qualificationStatus,
              production_approval_status AS productionApprovalStatus,
              reference_system AS referenceSystem
       FROM catalog_compatibilities
       WHERE import_id = ?
         AND reference_system = 'Automatic catalog compatibility rule'
         AND (
           hose_sku IN (SELECT value FROM json_each(?))
           OR hose_end_sku IN (SELECT value FROM json_each(?))
           OR ferrule_sku IN (SELECT value FROM json_each(?))
         )
       ORDER BY compatibility_id`,
    )
    .bind(
      release.draft_import_id,
      JSON.stringify(hoseSkus),
      JSON.stringify(hoseEndSkus),
      JSON.stringify(ferruleSkus),
    )
    .all<AutomaticRelationshipRow>();
  const desiredRelationships = await database
    .prepare(
      `SELECT 'AUTO:' || hose.sku || ':' || hose_end.sku || ':' || ferrule.sku
                AS compatibilityId,
              hose.sku AS hoseSku, hose_end.sku AS hoseEndSku,
              ferrule.sku AS ferruleSku,
              'Published' AS catalogPublicationStatus,
              hose_detail.skive_requirement AS skiveRequirement,
              'Eligible' AS rfqEligibility,
              'Pending' AS technicalDataStatus,
              'Not Tested' AS qualificationStatus,
              'not_approved' AS productionApprovalStatus,
              'Automatic catalog compatibility rule' AS referenceSystem
       FROM catalog_skus hose
       INNER JOIN catalog_hose_variants hose_detail
         ON hose_detail.import_id = hose.import_id
        AND hose_detail.sku = hose.sku
       INNER JOIN catalog_skus hose_end
         ON hose_end.import_id = hose.import_id
        AND hose_end.product_type = 'hose_end'
        AND hose_end.catalog_publication_status = 'Published'
        AND hose_end.rfq_eligibility = 'Eligible'
        AND hose_end.supply_availability = 'available_for_quote'
       INNER JOIN catalog_hose_ends hose_end_detail
         ON hose_end_detail.import_id = hose_end.import_id
        AND hose_end_detail.sku = hose_end.sku
        AND hose_end_detail.hose_tail_dash = hose_detail.dash
       INNER JOIN catalog_skus ferrule
         ON ferrule.import_id = hose.import_id
        AND ferrule.product_type = 'ferrule'
        AND ferrule.catalog_publication_status = 'Published'
        AND ferrule.rfq_eligibility = 'Eligible'
        AND ferrule.supply_availability = 'available_for_quote'
       INNER JOIN catalog_ferrules ferrule_detail
         ON ferrule_detail.import_id = ferrule.import_id
        AND ferrule_detail.sku = ferrule.sku
        AND ferrule_detail.ferrule_series = hose_detail.hose_series
        AND ferrule_detail.hose_tail_dash = hose_detail.dash
        AND ferrule_detail.skive_requirement = hose_detail.skive_requirement
       WHERE hose.import_id = ?1
         AND hose.product_type = 'hose'
         AND hose.catalog_publication_status = 'Published'
         AND hose.rfq_eligibility = 'Eligible'
         AND hose.supply_availability = 'available_for_quote'
         AND NOT EXISTS (
           SELECT 1 FROM catalog_compatibilities explicit_relationship
           WHERE explicit_relationship.import_id = hose.import_id
             AND explicit_relationship.hose_sku = hose.sku
             AND explicit_relationship.hose_end_sku = hose_end.sku
             AND explicit_relationship.ferrule_sku = ferrule.sku
             AND explicit_relationship.reference_system
                   IS NOT 'Automatic catalog compatibility rule'
         )
         AND (
           hose.sku IN (SELECT value FROM json_each(?2))
           OR hose_end.sku IN (SELECT value FROM json_each(?3))
           OR ferrule.sku IN (SELECT value FROM json_each(?4))
         )
       ORDER BY compatibilityId`,
    )
    .bind(
      release.draft_import_id,
      JSON.stringify(hoseSkus),
      JSON.stringify(hoseEndSkus),
      JSON.stringify(ferruleSkus),
    )
    .all<AutomaticRelationshipRow>();
  const beforeById = new Map(
    beforeRelationships.results.map((relationship) => [
      relationship.compatibilityId,
      JSON.stringify(relationship),
    ]),
  );
  const desiredById = new Map(
    desiredRelationships.results.map((relationship) => [
      relationship.compatibilityId,
      JSON.stringify(relationship),
    ]),
  );
  if (
    beforeById.size === desiredById.size &&
    [...desiredById].every(
      ([id, fingerprint]) => beforeById.get(id) === fingerprint,
    )
  ) {
    return { addedCount: 0, affectedSkus, removedCount: 0 };
  }
  const addedCount = [...desiredById.keys()].filter(
    (id) => !beforeById.has(id),
  ).length;
  const removedCount = [...beforeById.keys()].filter(
    (id) => !desiredById.has(id),
  ).length;

  await database.batch([
    database
      .prepare(
        `DELETE FROM catalog_compatibilities
         WHERE import_id = ?
           AND reference_system = 'Automatic catalog compatibility rule'
           AND (
           hose_sku IN (SELECT value FROM json_each(?))
           OR hose_end_sku IN (SELECT value FROM json_each(?))
           OR ferrule_sku IN (SELECT value FROM json_each(?))
         )`,
      )
      .bind(
        release.draft_import_id,
        JSON.stringify(hoseSkus),
        JSON.stringify(hoseEndSkus),
        JSON.stringify(ferruleSkus),
      ),
    database
      .prepare(
        `INSERT OR IGNORE INTO catalog_compatibilities (
           id, import_id, compatibility_id, hose_sku, hose_end_sku,
           ferrule_sku, catalog_publication_status, assembly_method,
           skive_requirement, outer_skive_length_mm, inner_skive_length_mm,
           insertion_depth_mm, crimp_program, final_crimp_diameter_mm,
           tolerance_mm, measurement_location, assembly_working_bar,
           proof_pressure_bar, proof_hold_seconds, qualification_id,
           qualification_status, rfq_eligibility, reference_system,
           reference_hose_code, reference_assembly_method,
           reference_crimp_diameter_mm, reference_tolerance_mm,
           reference_source, notes, technical_data_status,
           production_approval_status
         )
         SELECT
           ?1 || ':auto-compat:' || hose.sku || ':' || hose_end.sku || ':' || ferrule.sku,
           ?1,
           'AUTO:' || hose.sku || ':' || hose_end.sku || ':' || ferrule.sku,
           hose.sku, hose_end.sku, ferrule.sku, 'Published', NULL,
           hose_detail.skive_requirement, NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, 'Not Tested', 'Eligible',
           'Automatic catalog compatibility rule', hose.sku, NULL, NULL,
           NULL, 'Matched by Hose Tail Dash, Hose Series, and skive requirement',
           NULL, 'Pending', 'not_approved'
         FROM catalog_skus hose
         INNER JOIN catalog_hose_variants hose_detail
           ON hose_detail.import_id = hose.import_id
          AND hose_detail.sku = hose.sku
         INNER JOIN catalog_skus hose_end
           ON hose_end.import_id = hose.import_id
          AND hose_end.product_type = 'hose_end'
          AND hose_end.catalog_publication_status = 'Published'
          AND hose_end.rfq_eligibility = 'Eligible'
          AND hose_end.supply_availability = 'available_for_quote'
         INNER JOIN catalog_hose_ends hose_end_detail
           ON hose_end_detail.import_id = hose_end.import_id
          AND hose_end_detail.sku = hose_end.sku
          AND hose_end_detail.hose_tail_dash = hose_detail.dash
         INNER JOIN catalog_skus ferrule
           ON ferrule.import_id = hose.import_id
          AND ferrule.product_type = 'ferrule'
          AND ferrule.catalog_publication_status = 'Published'
          AND ferrule.rfq_eligibility = 'Eligible'
          AND ferrule.supply_availability = 'available_for_quote'
         INNER JOIN catalog_ferrules ferrule_detail
           ON ferrule_detail.import_id = ferrule.import_id
          AND ferrule_detail.sku = ferrule.sku
          AND ferrule_detail.ferrule_series = hose_detail.hose_series
          AND ferrule_detail.hose_tail_dash = hose_detail.dash
          AND ferrule_detail.skive_requirement = hose_detail.skive_requirement
         WHERE hose.import_id = ?1
           AND hose.product_type = 'hose'
           AND hose.catalog_publication_status = 'Published'
           AND hose.rfq_eligibility = 'Eligible'
           AND hose.supply_availability = 'available_for_quote'
           AND NOT EXISTS (
             SELECT 1 FROM catalog_compatibilities explicit_relationship
             WHERE explicit_relationship.import_id = hose.import_id
               AND explicit_relationship.hose_sku = hose.sku
               AND explicit_relationship.hose_end_sku = hose_end.sku
               AND explicit_relationship.ferrule_sku = ferrule.sku
               AND explicit_relationship.reference_system
                     IS NOT 'Automatic catalog compatibility rule'
           )
           AND (
             hose.sku IN (SELECT value FROM json_each(?2))
             OR hose_end.sku IN (SELECT value FROM json_each(?3))
             OR ferrule.sku IN (SELECT value FROM json_each(?4))
           )`,
      )
      .bind(
        release.draft_import_id,
        JSON.stringify(hoseSkus),
        JSON.stringify(hoseEndSkus),
        JSON.stringify(ferruleSkus),
      ),
    database
      .prepare(
        `UPDATE catalog_imports
         SET summary_json = json_set(
           summary_json,
           '$.compatibilityCount',
           (SELECT COUNT(*) FROM catalog_compatibilities WHERE import_id = ?)
         )
         WHERE id = ?`,
      )
      .bind(release.draft_import_id, release.draft_import_id),
    database
      .prepare(
        `INSERT INTO admin_audit_events (
           id, event_type, entity_type, entity_id,
           actor_id, payload_json, occurred_at
         ) VALUES (?, 'catalog_release.compatibilities_expanded',
                   'catalog_release', ?, ?, json_object(
                     'affectedSkus', json(?),
                     'before', json(?),
                     'after', (
                       SELECT COALESCE(json_group_array(json_object(
                         'compatibilityId', compatibility_id,
                         'hoseSku', hose_sku,
                         'hoseEndSku', hose_end_sku,
                         'ferruleSku', ferrule_sku,
                         'catalogPublicationStatus', catalog_publication_status,
                         'skiveRequirement', skive_requirement,
                         'rfqEligibility', rfq_eligibility,
                         'technicalDataStatus', technical_data_status,
                         'qualificationStatus', qualification_status,
                         'productionApprovalStatus', production_approval_status,
                         'referenceSystem', reference_system
                       )), json('[]'))
                       FROM (
                         SELECT * FROM catalog_compatibilities
                         WHERE import_id = ?
                           AND reference_system = 'Automatic catalog compatibility rule'
                           AND (
                             hose_sku IN (SELECT value FROM json_each(?))
                             OR hose_end_sku IN (SELECT value FROM json_each(?))
                             OR ferrule_sku IN (SELECT value FROM json_each(?))
                         )
                         ORDER BY compatibility_id
                       )
                     ),
                     'beforeAutomaticRelationshipCount', ?,
                     'afterAutomaticRelationshipCount', (
                       SELECT COUNT(*) FROM catalog_compatibilities
                       WHERE import_id = ?
                         AND reference_system = 'Automatic catalog compatibility rule'
                         AND (
                           hose_sku IN (SELECT value FROM json_each(?))
                           OR hose_end_sku IN (SELECT value FROM json_each(?))
                           OR ferrule_sku IN (SELECT value FROM json_each(?))
                         )
                     ),
                     'requestCorrelationId', ?,
                     'ipAddress', ?,
                     'rule', ?
                   ), ?)`,
      )
      .bind(
        auditEventId,
        input.releaseId,
        input.actorId,
        JSON.stringify(affectedSkus),
        JSON.stringify(beforeRelationships.results),
        release.draft_import_id,
        JSON.stringify(hoseSkus),
        JSON.stringify(hoseEndSkus),
        JSON.stringify(ferruleSkus),
        beforeRelationships.results.length,
        release.draft_import_id,
        JSON.stringify(hoseSkus),
        JSON.stringify(hoseEndSkus),
        JSON.stringify(ferruleSkus),
        input.requestCorrelationId,
        input.ipAddress,
        "hose_end.hose_tail_dash = hose.dash; ferrule series/dash/skive = hose series/dash/skive",
        occurredAt,
      ),
  ]);

  return {
    addedCount,
    affectedSkus,
    removedCount,
  };
}
