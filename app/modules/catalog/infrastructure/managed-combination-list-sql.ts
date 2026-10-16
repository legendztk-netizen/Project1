// The Assembly Management list over the same rows as catalog_runtime_assembly_combinations
// (migration 0133) at the baseline release, without the view's per-row work. The view pairs
// generated endpoints by re-reading endpoint JSON in the join and looks up both compatibility IDs
// per pair; at ~460k one-piece pairs one page took ~8M rows read. Here endpoint JSON is read once
// into plain columns, so the pairing join uses an automatic index, and generated pairs take their
// compatibility IDs from their own endpoints: catalog_runtime_compatibilities exposes exactly those
// generated endpoints for managed series. Manual rows and the legacy fallback keep the view's rules.
// Filters reach the endpoints before pairing. Runtime values stay bound.
export interface ManagedCombinationFilters {
  endA?: string;
  endB?: string;
  series?: string;
  q?: string;
  enabled?: string;
  ready?: string;
}

export function managedCombinationsSql(
  releaseId: string,
  filters: ManagedCombinationFilters = {},
  identities?: string[],
) {
  const values: unknown[] = [];
  // Numbered, because clauses are assembled out of text order.
  const bind = (value: unknown) => `?${values.push(value)}`;
  const wanted = identities ? JSON.stringify(identities) : null;
  const and = (clauses: Array<string | false | null | undefined>) =>
    clauses
      .filter(Boolean)
      .map((clause) => ` AND ${clause}`)
      .join("");
  const endpointScope = and([
    filters.series && `s.hose_series=${bind(filters.series)}`,
    wanted &&
      `json_extract(e.value,'$.hose_sku') IN (SELECT json_extract(value,'$[0]') FROM json_each(${bind(wanted)}))`,
  ]);
  const generatedScope = and([
    filters.endA && `a.hose_end_sku=${bind(filters.endA)}`,
    filters.endB && `b.hose_end_sku=${bind(filters.endB)}`,
  ]);
  const legacyScope = and([
    filters.series && `h.hose_series=${bind(filters.series)}`,
    filters.endA && `a.hose_end_sku=${bind(filters.endA)}`,
    filters.endB && `b.hose_end_sku=${bind(filters.endB)}`,
    wanted &&
      `a.hose_sku IN (SELECT json_extract(value,'$[0]') FROM json_each(${bind(wanted)}))`,
  ]);
  const manualCompatibility = (end: "A" | "B") =>
    `(SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=current.import_id
   AND e.hose_sku=json_extract(m.payload_json,'$.hoseSku') AND e.hose_end_sku=json_extract(m.payload_json,'$.end${end}HoseEndSku')
   AND e.ferrule_sku IS json_extract(m.payload_json,'$.end${end}FerruleSku'))`;
  // A scalar lookup, so the runtime hose view is read per hose instead of materialized whole.
  const hoseSeriesOf = (sku: string) =>
    `(SELECT h.hose_series FROM catalog_runtime_hose_variants h WHERE h.import_id=current.import_id AND h.sku=${sku})`;
  const current = bind(releaseId);
  const rowScope = and([
    filters.series && `c.hose_series=${bind(filters.series)}`,
    filters.endA && `c.end_a_hose_end_sku=${bind(filters.endA)}`,
    filters.endB && `c.end_b_hose_end_sku=${bind(filters.endB)}`,
    filters.q && `instr(lower(c.identity),lower(${bind(filters.q)}))>0`,
    filters.enabled &&
      `c.identity ${filters.enabled === "disabled" ? "IN" : "NOT IN"} (SELECT identity FROM catalog_assembly_exclusions WHERE disabled=1)`,
    filters.ready &&
      `c.hose_series ${filters.ready === "pending" ? "IN" : "NOT IN"} (SELECT hose_series FROM catalog_assembly_pending_series)`,
    wanted && `c.identity IN (SELECT value FROM json_each(${bind(wanted)}))`,
  ]);
  const sql = `WITH current AS MATERIALIZED (
 SELECT r.id AS release_id,r.source_import_id AS import_id
 FROM catalog_item_publication_state state JOIN catalog_releases r ON r.id=state.baseline_release_id
 WHERE state.mode='items' AND r.id=${current}
), endpoint AS MATERIALIZED (
 SELECT s.hose_series,s.generation_id,
 json_extract(e.value,'$.hose_sku') AS hose_sku,
 json_extract(e.value,'$.hose_end_sku') AS hose_end_sku,
 json_extract(e.value,'$.ferrule_sku') AS ferrule_sku,
 json_extract(e.value,'$.compatibility_id') AS compatibility_id
 FROM current JOIN catalog_assembly_managed_series s ON s.generation_id IS NOT NULL
 JOIN catalog_assembly_operations o ON o.id=s.generation_id,
 json_each(o.payload_json,'$.endpoints') e
 WHERE 1${endpointScope}
), legacy_hose AS MATERIALIZED (
 SELECT l.hose_sku AS sku,${hoseSeriesOf("l.hose_sku")} AS hose_series
 FROM current JOIN (SELECT DISTINCT a.hose_sku FROM current JOIN catalog_compatibilities a ON a.import_id=current.import_id) l
), combination AS (
 SELECT * FROM (
  SELECT a.hose_series,a.hose_sku,
  json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku) AS identity,
  a.compatibility_id AS end_a_compatibility_id,a.hose_end_sku AS end_a_hose_end_sku,a.ferrule_sku AS end_a_ferrule_sku,
  b.compatibility_id AS end_b_compatibility_id,b.hose_end_sku AS end_b_hose_end_sku,b.ferrule_sku AS end_b_ferrule_sku
  FROM endpoint a JOIN endpoint b ON b.generation_id=a.generation_id AND b.hose_sku=a.hose_sku
  WHERE 1${generatedScope}
 ) g WHERE g.identity NOT IN (SELECT identity FROM catalog_assembly_manual)
 UNION ALL
 SELECT COALESCE(${hoseSeriesOf("json_extract(m.payload_json,'$.hoseSku')")},m.hose_series),json_extract(m.payload_json,'$.hoseSku'),m.identity,
 ${manualCompatibility("A")},json_extract(m.payload_json,'$.endAHoseEndSku'),json_extract(m.payload_json,'$.endAFerruleSku'),
 ${manualCompatibility("B")},json_extract(m.payload_json,'$.endBHoseEndSku'),json_extract(m.payload_json,'$.endBFerruleSku')
 FROM current JOIN catalog_assembly_manual m
 UNION ALL
 SELECT h.hose_series,a.hose_sku,json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku),
 a.compatibility_id,a.hose_end_sku,a.ferrule_sku,b.compatibility_id,b.hose_end_sku,b.ferrule_sku
 FROM current JOIN legacy_hose h ON h.hose_series IS NOT NULL
 AND h.hose_series NOT IN (SELECT hose_series FROM catalog_assembly_managed_series WHERE generation_id IS NOT NULL)
 JOIN catalog_compatibilities a ON a.import_id=current.import_id AND a.hose_sku=h.sku
 JOIN catalog_compatibilities b ON b.import_id=a.import_id AND b.hose_sku=a.hose_sku
 WHERE json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku) NOT IN (SELECT identity FROM catalog_assembly_manual)
 AND (NOT EXISTS (SELECT 1 FROM catalog_derived_assembly_series s WHERE s.release_id=current.release_id)
 OR EXISTS (SELECT 1 FROM catalog_derived_assembly_combinations d WHERE d.release_id=current.release_id AND d.hose_sku=a.hose_sku
 AND d.end_a_compatibility_id=a.compatibility_id AND d.end_b_compatibility_id=b.compatibility_id))${legacyScope}
)
SELECT c.* FROM combination c WHERE 1${rowScope}`;
  return { sql, values };
}
