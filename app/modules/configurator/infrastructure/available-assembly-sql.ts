import { unavailableHoseSql } from "./unavailable-hose-sql";
import { assemblyCombinationsSql } from "./scoped-assembly-combinations-sql";

// Point validation equivalent to catalog_available_assembly_combinations. Scope the
// ordered identity before pairing endpoints; retain all publication and availability guards.
// Arguments are trusted SQL expressions; callers bind all request values.
export function availableAssemblySql({
  releaseId,
  hoseSku,
  endACompatibilityId,
  endBCompatibilityId,
  identity,
}: {
  releaseId: string;
  hoseSku: string;
  endACompatibilityId: string;
  endBCompatibilityId: string;
  identity: string;
}) {
  return `          WITH release AS MATERIALIZED (
            SELECT * FROM catalog_releases WHERE id = ${releaseId}
              AND status IN ('published', 'superseded')
          ), combinations AS MATERIALIZED (
            ${assemblyCombinationsSql(releaseId, hoseSku, identity)}
          ), endpoints AS MATERIALIZED (
            SELECT * FROM catalog_runtime_compatibilities
            WHERE import_id IN (SELECT source_import_id FROM release)
              AND hose_sku = ${hoseSku} AND compatibility_id IN (${endACompatibilityId}, ${endBCompatibilityId})
          ), skus AS MATERIALIZED (
            SELECT * FROM catalog_runtime_skus
            WHERE import_id IN (SELECT source_import_id FROM release)
              AND sku IN (SELECT value FROM json_each(${identity}))
          )
          SELECT 1 AS found FROM combinations c
          JOIN release r ON r.id = c.release_id
          JOIN endpoints a ON a.import_id = r.source_import_id AND a.hose_sku = c.hose_sku
            AND a.compatibility_id = c.end_a_compatibility_id
            AND a.hose_end_sku = c.end_a_hose_end_sku AND a.ferrule_sku = c.end_a_ferrule_sku
          JOIN endpoints b ON b.import_id = r.source_import_id AND b.hose_sku = c.hose_sku
            AND b.compatibility_id = c.end_b_compatibility_id
            AND b.hose_end_sku = c.end_b_hose_end_sku AND b.ferrule_sku = c.end_b_ferrule_sku
          WHERE c.end_a_compatibility_id=${endACompatibilityId} AND c.end_b_compatibility_id=${endBCompatibilityId}
            AND a.catalog_publication_status = 'Published' AND a.rfq_eligibility = 'Eligible'
            AND b.catalog_publication_status = 'Published' AND b.rfq_eligibility = 'Eligible'
            AND NOT EXISTS (${unavailableHoseSql(hoseSku)})
            AND (SELECT COUNT(*) FROM skus p WHERE p.import_id = r.source_import_id
              AND p.catalog_publication_status = 'Published' AND p.rfq_eligibility = 'Eligible'
              AND p.supply_availability = 'available_for_quote')
              = (SELECT COUNT(DISTINCT value) FROM json_each(c.identity))
            AND NOT EXISTS (
              SELECT 1 FROM catalog_assembly_exclusions x
              JOIN catalog_item_publication_state state ON state.mode = 'items' AND state.baseline_release_id = c.release_id
              WHERE x.identity = c.identity AND x.disabled = 1
            )
          LIMIT 1`;
}
