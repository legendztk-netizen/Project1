-- One-piece Hose Ends carry no ferrule (ADR 0056): generated endpoints and
-- combination identities hold JSON null in the ferrule slot. The runtime
-- combination views matched ferrules with `=`, which never holds for NULL, so
-- they compare with IS. NULL component SKUs drop out of the availability count
-- the same way they drop out of COUNT(DISTINCT value) over the identity.
DROP VIEW catalog_available_assembly_combinations;
--> statement-breakpoint
DROP VIEW catalog_valid_assembly_combinations;
--> statement-breakpoint
DROP VIEW catalog_runtime_assembly_combinations;
--> statement-breakpoint
CREATE VIEW catalog_runtime_assembly_combinations AS
SELECT r.id AS release_id,c.identity,c.hose_series,
 json_extract(c.payload_json,'$.hoseSku') AS hose_sku,
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=r.source_import_id AND e.hose_sku=json_extract(c.payload_json,'$.hoseSku') AND e.hose_end_sku=json_extract(c.payload_json,'$.endAHoseEndSku') AND e.ferrule_sku IS json_extract(c.payload_json,'$.endAFerruleSku')) AS end_a_compatibility_id,
 json_extract(c.payload_json,'$.endAHoseEndSku') AS end_a_hose_end_sku,
 json_extract(c.payload_json,'$.endAFerruleSku') AS end_a_ferrule_sku,
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=r.source_import_id AND e.hose_sku=json_extract(c.payload_json,'$.hoseSku') AND e.hose_end_sku=json_extract(c.payload_json,'$.endBHoseEndSku') AND e.ferrule_sku IS json_extract(c.payload_json,'$.endBFerruleSku')) AS end_b_compatibility_id,
 json_extract(c.payload_json,'$.endBHoseEndSku') AS end_b_hose_end_sku,
 json_extract(c.payload_json,'$.endBFerruleSku') AS end_b_ferrule_sku
FROM catalog_assembly_current_combinations c JOIN catalog_item_publication_state s ON s.mode='items'
JOIN catalog_releases r ON r.id=s.baseline_release_id
UNION ALL
SELECT r.id,json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku),h.hose_series,
a.hose_sku,a.compatibility_id,a.hose_end_sku,a.ferrule_sku,b.compatibility_id,b.hose_end_sku,b.ferrule_sku
FROM catalog_releases r JOIN catalog_compatibilities a ON a.import_id=r.source_import_id
JOIN catalog_compatibilities b ON b.import_id=a.import_id AND b.hose_sku=a.hose_sku
JOIN catalog_runtime_hose_variants h ON h.import_id=a.import_id AND h.sku=a.hose_sku
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_managed_series s ON s.hose_series=h.hose_series
 WHERE state.mode='items' AND state.baseline_release_id=r.id AND s.generation_id IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM catalog_item_publication_state state JOIN catalog_assembly_manual m
 ON m.identity=json_array(a.hose_sku,a.hose_end_sku,a.ferrule_sku,b.hose_end_sku,b.ferrule_sku)
 WHERE state.mode='items' AND state.baseline_release_id=r.id)
AND (NOT EXISTS (SELECT 1 FROM catalog_derived_assembly_series s WHERE s.release_id=r.id)
OR EXISTS (SELECT 1 FROM catalog_derived_assembly_combinations d WHERE d.release_id=r.id AND d.hose_sku=a.hose_sku
AND d.end_a_compatibility_id=a.compatibility_id AND d.end_b_compatibility_id=b.compatibility_id));
--> statement-breakpoint
CREATE VIEW catalog_valid_assembly_combinations AS
SELECT c.* FROM catalog_runtime_assembly_combinations c
JOIN catalog_releases r ON r.id=c.release_id
JOIN catalog_runtime_compatibilities a ON a.import_id=r.source_import_id AND a.hose_sku=c.hose_sku
 AND a.compatibility_id=c.end_a_compatibility_id AND a.hose_end_sku=c.end_a_hose_end_sku AND a.ferrule_sku IS c.end_a_ferrule_sku
JOIN catalog_runtime_compatibilities b ON b.import_id=r.source_import_id AND b.hose_sku=c.hose_sku
 AND b.compatibility_id=c.end_b_compatibility_id AND b.hose_end_sku=c.end_b_hose_end_sku AND b.ferrule_sku IS c.end_b_ferrule_sku
WHERE r.status IN ('published','superseded')
AND a.catalog_publication_status='Published' AND a.rfq_eligibility='Eligible'
AND b.catalog_publication_status='Published' AND b.rfq_eligibility='Eligible'
AND NOT EXISTS (SELECT 1 FROM catalog_item_unavailable_hoses h WHERE h.sku=c.hose_sku)
AND (SELECT COUNT(*) FROM catalog_runtime_skus p WHERE p.import_id=r.source_import_id
 AND p.sku IN (c.hose_sku,c.end_a_hose_end_sku,c.end_a_ferrule_sku,c.end_b_hose_end_sku,c.end_b_ferrule_sku)
 AND p.catalog_publication_status='Published' AND p.rfq_eligibility='Eligible' AND p.supply_availability='available_for_quote')
 = (SELECT COUNT(DISTINCT value) FROM json_each(c.identity));
--> statement-breakpoint
CREATE VIEW catalog_available_assembly_combinations AS SELECT c.* FROM catalog_valid_assembly_combinations c WHERE NOT EXISTS (SELECT 1 FROM catalog_assembly_exclusions x JOIN catalog_item_publication_state state ON state.mode='items' AND state.baseline_release_id=c.release_id WHERE x.identity=c.identity AND x.disabled=1);
--> statement-breakpoint
UPDATE application_schema_state SET version=134,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
