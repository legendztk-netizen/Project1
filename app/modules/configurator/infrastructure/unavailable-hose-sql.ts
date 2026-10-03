// Point-scoped equivalent of catalog_item_unavailable_hoses (migration 0079).
// Deliberately consult the CURRENT item baseline even for a superseded release.
// hoseSku is a trusted SQL expression; callers bind request values.
export function unavailableHoseSql(hoseSku: string) {
  return `/* catalog_item_unavailable_hoses: point lookup */
    WITH baseline AS MATERIALIZED (
      SELECT r.source_import_id AS import_id FROM catalog_item_publication_state state
      JOIN catalog_releases r ON r.id=state.baseline_release_id WHERE state.mode='items'
    ), hoses AS MATERIALIZED (
      SELECT import_id,sku,hose_series FROM catalog_runtime_hose_variants
      WHERE import_id IN (SELECT import_id FROM baseline) AND sku=${hoseSku}
    ), skus AS MATERIALIZED (
      SELECT import_id,sku,catalog_publication_status,rfq_eligibility,supply_availability
      FROM catalog_runtime_skus WHERE import_id IN (SELECT import_id FROM baseline)
        AND sku=${hoseSku} AND product_type='hose'
    )
    SELECT h.sku FROM hoses h JOIN skus p ON p.import_id=h.import_id AND p.sku=h.sku
    WHERE h.hose_series IN (SELECT hose_series FROM catalog_assembly_pending_series)
      OR p.catalog_publication_status <> 'Published' OR p.rfq_eligibility <> 'Eligible'
      OR p.supply_availability <> 'available_for_quote'`;
}
