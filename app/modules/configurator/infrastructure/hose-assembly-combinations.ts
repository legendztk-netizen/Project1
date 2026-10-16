// The runtime combinations of one hose (scopedAssemblyCombinationsSql) without pairing in SQL.
// A managed hose's generated combinations are every ordered pair of its endpoints, so this reads the
// endpoints once and pairs them here; SQL pairing re-read endpoint JSON for each of the n² pairs and
// looked up both compatibility IDs per pair (~3M rows read for one hose on the local data). Generated
// pairs take their compatibility IDs from their own endpoints, which is what the lookup returns:
// catalog_runtime_compatibilities exposes exactly those generated endpoints for managed series.
// Manual rows and the legacy fallback (unmanaged series, few rows) are read as complete combinations.
// Ferrule slots may be NULL (one-piece Hose Ends, migration 0133), so they compare with IS.

export interface HoseAssemblyCombination {
  identity: string;
  hose_series: string;
  hose_sku: string;
  end_a_compatibility_id: string | null;
  end_a_hose_end_sku: string;
  end_a_ferrule_sku: string | null;
  end_b_compatibility_id: string | null;
  end_b_hose_end_sku: string;
  end_b_ferrule_sku: string | null;
}

interface HoseAssemblyPart extends Omit<HoseAssemblyCombination, "identity"> {
  part: "endpoint" | "manual" | "legacy";
  generation_id: string | null;
  identity: string | null;
}

// ?1 release ID, ?2 hose SKU.
export const hoseAssemblyPartsSql = `WITH baseline AS MATERIALIZED (
 SELECT r.id AS release_id,r.source_import_id AS import_id
 FROM catalog_item_publication_state s JOIN catalog_releases r ON r.id=s.baseline_release_id
 WHERE s.mode='items' AND r.id=?1
)
SELECT 'endpoint' AS part,s.hose_series,s.generation_id,NULL AS identity,?2 AS hose_sku,
 json_extract(e.value,'$.compatibility_id') AS end_a_compatibility_id,
 json_extract(e.value,'$.hose_end_sku') AS end_a_hose_end_sku,
 json_extract(e.value,'$.ferrule_sku') AS end_a_ferrule_sku,
 NULL AS end_b_compatibility_id,NULL AS end_b_hose_end_sku,NULL AS end_b_ferrule_sku
FROM baseline JOIN catalog_assembly_managed_series s ON s.generation_id IS NOT NULL
JOIN catalog_assembly_operations o ON o.id=s.generation_id,
json_each(o.payload_json,'$.endpoints') e
WHERE json_extract(e.value,'$.hose_sku')=?2
UNION ALL
SELECT 'manual',COALESCE((SELECT h.hose_series FROM catalog_runtime_hose_variants h WHERE h.import_id=b.import_id AND h.sku=?2),m.hose_series),
 m.operation_id,m.identity,?2,
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=b.import_id AND e.hose_sku=?2
  AND e.hose_end_sku=json_extract(m.payload_json,'$.endAHoseEndSku') AND e.ferrule_sku IS json_extract(m.payload_json,'$.endAFerruleSku')),
 json_extract(m.payload_json,'$.endAHoseEndSku'),json_extract(m.payload_json,'$.endAFerruleSku'),
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=b.import_id AND e.hose_sku=?2
  AND e.hose_end_sku=json_extract(m.payload_json,'$.endBHoseEndSku') AND e.ferrule_sku IS json_extract(m.payload_json,'$.endBFerruleSku')),
 json_extract(m.payload_json,'$.endBHoseEndSku'),json_extract(m.payload_json,'$.endBFerruleSku')
FROM baseline b JOIN catalog_assembly_manual m ON json_extract(m.payload_json,'$.hoseSku')=?2
UNION ALL
SELECT 'legacy',h.hose_series,NULL,json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku),a.hose_sku,
a.compatibility_id,a.hose_end_sku,a.ferrule_sku,b.compatibility_id,b.hose_end_sku,b.ferrule_sku
FROM catalog_releases r JOIN catalog_compatibilities a ON a.import_id=r.source_import_id
JOIN catalog_compatibilities b ON b.import_id=a.import_id AND b.hose_sku=a.hose_sku
JOIN catalog_runtime_hose_variants h ON h.import_id=a.import_id AND h.sku=a.hose_sku
WHERE r.id=?1 AND a.hose_sku=?2
AND NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_managed_series s ON s.hose_series=h.hose_series
 WHERE state.mode='items' AND state.baseline_release_id=r.id AND s.generation_id IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_manual m
 ON m.identity=json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku)
 WHERE state.mode='items' AND state.baseline_release_id=r.id)
AND (NOT EXISTS (SELECT 1 FROM catalog_derived_assembly_series s WHERE s.release_id=r.id)
OR EXISTS (SELECT 1 FROM catalog_derived_assembly_combinations d WHERE d.release_id=r.id AND d.hose_sku=a.hose_sku
AND d.end_a_compatibility_id=a.compatibility_id AND d.end_b_compatibility_id=b.compatibility_id))`;

/** Same rows as scopedAssemblyCombinationsSql for the hose, from the parts read by hoseAssemblyPartsSql. */
export function hoseAssemblyCombinations(
  parts: HoseAssemblyPart[],
): HoseAssemblyCombination[] {
  const combination = ({
    hose_series,
    hose_sku,
    end_a_compatibility_id,
    end_a_hose_end_sku,
    end_a_ferrule_sku,
    end_b_compatibility_id,
    end_b_hose_end_sku,
    end_b_ferrule_sku,
  }: Omit<HoseAssemblyCombination, "identity">) => ({
    // json_array() text: no whitespace, NULL as null.
    identity: JSON.stringify([
      hose_sku,
      end_a_hose_end_sku,
      end_a_ferrule_sku,
      end_b_hose_end_sku,
      end_b_ferrule_sku,
    ]),
    hose_series,
    hose_sku,
    end_a_compatibility_id,
    end_a_hose_end_sku,
    end_a_ferrule_sku,
    end_b_compatibility_id,
    end_b_hose_end_sku,
    end_b_ferrule_sku,
  });
  const manual = new Set(
    parts.filter((p) => p.part === "manual").map((p) => p.identity),
  );
  const endpoints = parts.filter((p) => p.part === "endpoint");
  const rows: HoseAssemblyCombination[] = [];
  for (const a of endpoints)
    for (const b of endpoints) {
      if (b.generation_id !== a.generation_id) continue;
      const row = combination({
        ...a,
        end_b_compatibility_id: b.end_a_compatibility_id,
        end_b_hose_end_sku: b.end_a_hose_end_sku,
        end_b_ferrule_sku: b.end_a_ferrule_sku,
      });
      if (!manual.has(row.identity)) rows.push(row);
    }
  for (const p of parts)
    if (p.part !== "endpoint")
      rows.push({ ...combination(p), identity: String(p.identity) });
  return rows;
}
