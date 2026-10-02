// Reference implementation (oracle) of the configurator's compatible-end query, kept verbatim from before the
// read-cost fix. For `findCompatibleEndA` it validated every derived combination of the hose against whole
// runtime views (~6M rows read per call on the preview data). Tests compare the new reader with it.
export function legacyCompatibleHoseEndSql(selectedOnly = false) {
  const compatibilities = selectedOnly
    ? "scoped_compatibilities"
    : "catalog_runtime_compatibilities";
  const skus = selectedOnly ? "scoped_skus" : "catalog_runtime_skus";
  const ends = selectedOnly ? "scoped_ends" : "catalog_runtime_hose_ends";
  const series = selectedOnly
    ? "scoped_series"
    : "catalog_runtime_hose_end_series";
  const ferrules = selectedOnly
    ? "scoped_ferrules"
    : "catalog_runtime_ferrules";
  return `
  WITH scoped_compatibilities AS MATERIALIZED (
    SELECT * FROM catalog_runtime_compatibilities
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND hose_sku = ?2
      ${selectedOnly ? "AND hose_end_sku IN (?3, ?4)" : ""}
  ), scoped_skus AS MATERIALIZED (
    SELECT * FROM catalog_runtime_skus
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND sku IN (SELECT hose_sku FROM scoped_compatibilities
        UNION SELECT hose_end_sku FROM scoped_compatibilities
        UNION SELECT ferrule_sku FROM scoped_compatibilities)
  ), scoped_ends AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_ends
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND sku IN (SELECT hose_end_sku FROM scoped_compatibilities)
  ), scoped_series AS MATERIALIZED (
    SELECT * FROM catalog_runtime_hose_end_series
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND series_code IN (SELECT fitting_series FROM scoped_ends)
  ), scoped_ferrules AS MATERIALIZED (
    SELECT * FROM catalog_runtime_ferrules
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND sku IN (SELECT ferrule_sku FROM scoped_compatibilities)
  ), eligible_endpoint AS (
    ${
      selectedOnly
        ? `
    SELECT ?1 AS release_id, hose_sku, compatibility_id
    FROM scoped_compatibilities
    WHERE import_id = (SELECT source_import_id FROM catalog_releases WHERE id = ?1)
      AND hose_sku = ?2 AND hose_end_sku IN (?3, ?4)
    `
        : `
    SELECT DISTINCT release_id,hose_sku,end_a_compatibility_id AS compatibility_id FROM catalog_available_assembly_combinations
    WHERE release_id = ?1 AND hose_sku = ?2
    UNION SELECT DISTINCT release_id,hose_sku,end_b_compatibility_id FROM catalog_available_assembly_combinations
    WHERE release_id = ?1 AND hose_sku = ?2
    `
    }
  )
  SELECT c.compatibility_id, c.hose_end_sku, c.ferrule_sku,
         c.assembly_working_bar,
         e.competitor_part_number, e.fitting_series, series.interface_family,
         series.connection_standard, series.gender, series.swivel_form,
         series.angle, series.sealing_form, e.thread,
         e.connection_dash, e.hose_tail_dash,
         e.max_working_bar,
         f.ferrule_series, f.hose_construction AS ferrule_hose_construction,
         f.hose_tail_dash AS ferrule_hose_tail_dash,
         f.skive_requirement AS ferrule_skive_requirement
  FROM catalog_releases r
  INNER JOIN eligible_endpoint derived
    ON derived.release_id = r.id
  INNER JOIN ${compatibilities} c
    ON c.import_id = r.source_import_id
   AND c.hose_sku = derived.hose_sku
   AND c.compatibility_id = derived.compatibility_id
  INNER JOIN ${skus} hs
    ON hs.import_id = c.import_id AND hs.sku = c.hose_sku
  INNER JOIN ${ends} e
    ON e.import_id = c.import_id AND e.sku = c.hose_end_sku
  INNER JOIN ${series} series
    ON series.import_id = e.import_id AND series.series_code = e.fitting_series
  INNER JOIN ${skus} es
    ON es.import_id = e.import_id AND es.sku = e.sku
  INNER JOIN ${ferrules} f
    ON f.import_id = c.import_id AND f.sku = c.ferrule_sku
  INNER JOIN ${skus} fs
    ON fs.import_id = f.import_id AND fs.sku = f.sku
  WHERE r.id = ?1
    AND r.status IN ('published', 'superseded')
    AND c.hose_sku = ?2
    AND NOT EXISTS (SELECT 1 FROM catalog_item_unavailable_hoses blocked WHERE blocked.sku = c.hose_sku)
    AND c.catalog_publication_status = 'Published'
    AND c.rfq_eligibility = 'Eligible'
    AND hs.product_type = 'hose'
    AND hs.catalog_publication_status = 'Published'
    AND hs.rfq_eligibility = 'Eligible'
    AND hs.supply_availability = 'available_for_quote'
    AND es.product_type = 'hose_end'
    AND es.catalog_publication_status = 'Published'
    AND es.rfq_eligibility = 'Eligible'
    AND es.supply_availability = 'available_for_quote'
    AND fs.product_type = 'ferrule'
    AND fs.catalog_publication_status = 'Published'
    AND fs.rfq_eligibility = 'Eligible'
    AND fs.supply_availability = 'available_for_quote'
  ORDER BY series.interface_family, series.angle, series.gender, series.swivel_form,
           e.connection_dash, e.hose_tail_dash, e.sku`;
}
