// Hose series whose baseline assembly combinations reference one SKU (bound as ?1).
// Equivalent to
//   SELECT DISTINCT hose_series FROM catalog_runtime_assembly_combinations
//   WHERE release_id = <baseline> AND ?1 IN (hose_sku, end_a/end_b hose end and ferrule SKUs)
// but the view pairs every generated endpoint of every series before filtering, which
// read ~230k D1 rows per hose-end or ferrule edit on preview. Here only the endpoints of
// hoses that mention the SKU are paired, and the legacy arm is filtered before its self-join.
// Keep in step with catalog_runtime_assembly_combinations (migrations/0057_managed_assemblies.sql).
const legacyArm = (filter: string, joins: string) => `
  SELECT h.hose_series FROM ${joins}
  JOIN catalog_runtime_hose_variants h ON h.import_id=a.import_id AND h.sku=a.hose_sku
  WHERE r.id=(SELECT baseline_release_id FROM catalog_item_publication_state WHERE singleton=1)
    AND ${filter}
    AND NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_managed_series s ON s.hose_series=h.hose_series
      WHERE state.mode='items' AND state.baseline_release_id=r.id AND s.generation_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_manual m
      ON m.identity=json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku)
      WHERE state.mode='items' AND state.baseline_release_id=r.id)
    AND (NOT EXISTS (SELECT 1 FROM catalog_derived_assembly_series s WHERE s.release_id=r.id)
      OR EXISTS (SELECT 1 FROM catalog_derived_assembly_combinations d WHERE d.release_id=r.id AND d.hose_sku=a.hose_sku
        AND d.end_a_compatibility_id=a.compatibility_id AND d.end_b_compatibility_id=b.compatibility_id))`;

export const retainedAssemblySeriesSql = `
WITH baseline AS MATERIALIZED (
  SELECT r.source_import_id AS import_id
  FROM catalog_item_publication_state state JOIN catalog_releases r ON r.id=state.baseline_release_id
  WHERE state.singleton=1 AND state.mode='items'
), endpoints AS MATERIALIZED (
  SELECT s.hose_series, s.generation_id, e.value AS endpoint, json_extract(e.value,'$.hose_sku') AS hose_sku
  FROM baseline, catalog_assembly_managed_series s
  JOIN catalog_assembly_operations o ON o.id=s.generation_id,
  json_each(o.payload_json,'$.endpoints') e
), hits AS MATERIALIZED (
  SELECT DISTINCT generation_id, hose_sku FROM endpoints
  WHERE ?1 IN (hose_sku, json_extract(endpoint,'$.hose_end_sku'), json_extract(endpoint,'$.ferrule_sku'))
)
SELECT a.hose_series FROM hits
JOIN endpoints a ON a.generation_id=hits.generation_id AND a.hose_sku=hits.hose_sku
JOIN endpoints b ON b.generation_id=hits.generation_id AND b.hose_sku=hits.hose_sku
WHERE ?1 IN (a.hose_sku, json_extract(a.endpoint,'$.hose_end_sku'), json_extract(a.endpoint,'$.ferrule_sku'),
             json_extract(b.endpoint,'$.hose_end_sku'), json_extract(b.endpoint,'$.ferrule_sku'))
  AND NOT EXISTS (SELECT 1 FROM catalog_assembly_manual m WHERE m.identity=json_array(a.hose_sku,
    json_extract(a.endpoint,'$.hose_end_sku'), json_extract(a.endpoint,'$.ferrule_sku'),
    json_extract(b.endpoint,'$.hose_end_sku'), json_extract(b.endpoint,'$.ferrule_sku')))
UNION
SELECT COALESCE(h.hose_series, m.hose_series) FROM baseline
CROSS JOIN catalog_assembly_manual m
LEFT JOIN catalog_runtime_hose_variants h ON h.import_id=baseline.import_id AND h.sku=json_extract(m.payload_json,'$.hoseSku')
WHERE ?1 IN (json_extract(m.payload_json,'$.hoseSku'), json_extract(m.payload_json,'$.endAHoseEndSku'),
  json_extract(m.payload_json,'$.endAFerruleSku'), json_extract(m.payload_json,'$.endBHoseEndSku'), json_extract(m.payload_json,'$.endBFerruleSku'))
UNION
${legacyArm(
  "(a.hose_sku=?1 OR a.hose_end_sku=?1 OR a.ferrule_sku=?1)",
  "catalog_releases r CROSS JOIN catalog_compatibilities a ON a.import_id=r.source_import_id CROSS JOIN catalog_compatibilities b ON b.import_id=a.import_id AND b.hose_sku=a.hose_sku",
)}
UNION
${legacyArm(
  "(b.hose_end_sku=?1 OR b.ferrule_sku=?1)",
  "catalog_releases r CROSS JOIN catalog_compatibilities b ON b.import_id=r.source_import_id CROSS JOIN catalog_compatibilities a ON a.import_id=b.import_id AND a.hose_sku=b.hose_sku",
)}`;
