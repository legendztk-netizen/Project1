// Same runtime combination rules as migration 0057, with the requested hose
// selected BEFORE pairing generated JSON endpoints. Filtering the outer view
// alone still builds pairs across every hose in the generation (quadratic reads).
// Keep manual overrides, legacy-release fallback and compatibility resolution.
// Expressions are internal SQL fragments, never user input. Runtime values stay bound.
export function assemblyCombinationsSql(
  releaseId: string,
  hoseSku: string,
  identity?: string,
) {
  const endpointFilter = identity
    ? ` AND (
 (json_extract(e.value,'$.hose_end_sku')=json_extract(${identity},'$[1]') AND json_extract(e.value,'$.ferrule_sku')=json_extract(${identity},'$[2]'))
 OR (json_extract(e.value,'$.hose_end_sku')=json_extract(${identity},'$[3]') AND json_extract(e.value,'$.ferrule_sku')=json_extract(${identity},'$[4]'))) `
    : "";
  return `WITH endpoints AS MATERIALIZED (
 SELECT s.hose_series,s.generation_id,e.value AS endpoint
 FROM catalog_assembly_managed_series s JOIN catalog_assembly_operations o ON o.id=s.generation_id,
 json_each(o.payload_json,'$.endpoints') e
 WHERE json_extract(e.value,'$.hose_sku')=${hoseSku}${endpointFilter}
), pairs AS (
 SELECT a.hose_series,a.generation_id,
 json_array(json_extract(a.endpoint,'$.hose_sku'),json_extract(a.endpoint,'$.hose_end_sku'),json_extract(a.endpoint,'$.ferrule_sku'),json_extract(b.endpoint,'$.hose_end_sku'),json_extract(b.endpoint,'$.ferrule_sku')) AS identity,
 json_object('hoseSku',json_extract(a.endpoint,'$.hose_sku'),'hoseSeries',a.hose_series,
 'endAHoseEndSku',json_extract(a.endpoint,'$.hose_end_sku'),'endAFerruleSku',json_extract(a.endpoint,'$.ferrule_sku'),
 'endBHoseEndSku',json_extract(b.endpoint,'$.hose_end_sku'),'endBFerruleSku',json_extract(b.endpoint,'$.ferrule_sku'),
 'endACompatibilityId',json_extract(a.endpoint,'$.compatibility_id'),'endBCompatibilityId',json_extract(b.endpoint,'$.compatibility_id'),
 'source',CASE WHEN json_extract(a.endpoint,'$.source')='import' OR json_extract(b.endpoint,'$.source')='import' THEN 'import' ELSE json_extract(a.endpoint,'$.source') END) AS payload_json
 FROM endpoints a JOIN endpoints b ON b.generation_id=a.generation_id AND json_extract(b.endpoint,'$.hose_sku')=json_extract(a.endpoint,'$.hose_sku')
), scoped_combinations AS (
SELECT identity,hose_series,json_set(payload_json,'$.identity',identity) AS payload_json,generation_id FROM pairs p
WHERE NOT EXISTS (SELECT 1 FROM catalog_assembly_manual m WHERE m.identity=p.identity)
UNION ALL SELECT m.identity,COALESCE(h.hose_series,m.hose_series),json_set(m.payload_json,'$.hoseSeries',COALESCE(h.hose_series,m.hose_series)),m.operation_id
FROM catalog_assembly_manual m LEFT JOIN catalog_item_publication_state state ON state.mode='items'
LEFT JOIN catalog_releases r ON r.id=state.baseline_release_id
LEFT JOIN catalog_runtime_hose_variants h ON h.import_id=r.source_import_id AND h.sku=json_extract(m.payload_json,'$.hoseSku')
WHERE json_extract(m.payload_json,'$.hoseSku')=${hoseSku}${identity ? ` AND m.identity=${identity}` : ""})
SELECT * FROM (
SELECT r.id AS release_id,c.identity,c.hose_series,
 json_extract(c.payload_json,'$.hoseSku') AS hose_sku,
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=r.source_import_id AND e.hose_sku=json_extract(c.payload_json,'$.hoseSku') AND e.hose_end_sku=json_extract(c.payload_json,'$.endAHoseEndSku') AND e.ferrule_sku=json_extract(c.payload_json,'$.endAFerruleSku')) AS end_a_compatibility_id,
 json_extract(c.payload_json,'$.endAHoseEndSku') AS end_a_hose_end_sku,
 json_extract(c.payload_json,'$.endAFerruleSku') AS end_a_ferrule_sku,
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=r.source_import_id AND e.hose_sku=json_extract(c.payload_json,'$.hoseSku') AND e.hose_end_sku=json_extract(c.payload_json,'$.endBHoseEndSku') AND e.ferrule_sku=json_extract(c.payload_json,'$.endBFerruleSku')) AS end_b_compatibility_id,
 json_extract(c.payload_json,'$.endBHoseEndSku') AS end_b_hose_end_sku,
 json_extract(c.payload_json,'$.endBFerruleSku') AS end_b_ferrule_sku
FROM scoped_combinations c JOIN catalog_item_publication_state s ON s.mode='items'
JOIN catalog_releases r ON r.id=s.baseline_release_id
UNION ALL
SELECT r.id,json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku),h.hose_series,
a.hose_sku,a.compatibility_id,a.hose_end_sku,a.ferrule_sku,b.compatibility_id,b.hose_end_sku,b.ferrule_sku
FROM catalog_releases r JOIN catalog_compatibilities a ON a.import_id=r.source_import_id
JOIN catalog_compatibilities b ON b.import_id=a.import_id AND b.hose_sku=a.hose_sku
JOIN catalog_runtime_hose_variants h ON h.import_id=a.import_id AND h.sku=a.hose_sku
WHERE a.hose_sku=${hoseSku}
${identity ? `AND a.hose_end_sku=json_extract(${identity},'$[1]') AND a.ferrule_sku=json_extract(${identity},'$[2]') AND b.hose_end_sku=json_extract(${identity},'$[3]') AND b.ferrule_sku=json_extract(${identity},'$[4]')` : ""}
AND NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_managed_series s ON s.hose_series=h.hose_series
 WHERE state.mode='items' AND state.baseline_release_id=r.id AND s.generation_id IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_manual m
 ON m.identity=json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku)
 WHERE state.mode='items' AND state.baseline_release_id=r.id)
AND (NOT EXISTS (SELECT 1 FROM catalog_derived_assembly_series s WHERE s.release_id=r.id)
OR EXISTS (SELECT 1 FROM catalog_derived_assembly_combinations d WHERE d.release_id=r.id AND d.hose_sku=a.hose_sku
AND d.end_a_compatibility_id=a.compatibility_id AND d.end_b_compatibility_id=b.compatibility_id))
) WHERE release_id=${releaseId} AND hose_sku=${hoseSku}${identity ? ` AND identity=${identity}` : ""}`;
}

export const scopedAssemblyCombinationsSql = assemblyCombinationsSql(
  "?1",
  "?2",
);
