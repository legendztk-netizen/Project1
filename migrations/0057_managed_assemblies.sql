-- Stable ordered identities and append-only operation history beside legacy releases.
CREATE TABLE catalog_assembly_operations (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('generate','manual','disable','enable','apply','reject','delete','failure')),
 hose_series TEXT NOT NULL, expected_sequence INTEGER NOT NULL, expected_relation_version INTEGER NOT NULL,
 expected_generation INTEGER, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 actor_id TEXT NOT NULL, ip_address TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE catalog_assembly_managed_series (
 hose_series TEXT PRIMARY KEY, relation_version INTEGER NOT NULL DEFAULT 0,
 generated_relation_version INTEGER NOT NULL DEFAULT 0,
 generation_id TEXT REFERENCES catalog_assembly_operations(id)
);
CREATE TABLE catalog_assembly_manual (
 identity TEXT PRIMARY KEY, hose_series TEXT NOT NULL, payload_json TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES catalog_assembly_operations(id)
);
CREATE TABLE catalog_assembly_exclusions (
 identity TEXT PRIMARY KEY, disabled INTEGER NOT NULL CHECK(disabled IN (0,1)),
 operation_id TEXT NOT NULL REFERENCES catalog_assembly_operations(id)
);
CREATE TABLE catalog_assembly_relation_overrides (
 identity TEXT PRIMARY KEY, hose_series TEXT NOT NULL, payload_json TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES catalog_assembly_operations(id)
);
--> statement-breakpoint
CREATE TRIGGER catalog_assembly_operation_guard BEFORE INSERT ON catalog_assembly_operations
WHEN NEW.kind <> 'failure'
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_item_publication_state WHERE mode='items')
 THEN RAISE(ABORT,'item publication is not enabled') END;
 SELECT CASE WHEN NEW.expected_generation IS NOT NULL AND NEW.expected_generation <>
 (SELECT generation FROM catalog_item_publication_state) THEN RAISE(ABORT,'product inputs changed') END;
 SELECT CASE WHEN NEW.expected_sequence <> COALESCE((SELECT invalidated_sequence FROM catalog_item_assembly_state WHERE hose_series=NEW.hose_series),0)
 OR NEW.expected_relation_version <> COALESCE((SELECT relation_version FROM catalog_assembly_managed_series WHERE hose_series=NEW.hose_series),0)
 THEN RAISE(ABORT,'assembly inputs changed; retry') END;
 SELECT CASE WHEN NEW.kind IN ('apply','reject','delete') AND NOT EXISTS
 (SELECT 1 FROM catalog_pending_relation_sources WHERE id=json_extract(NEW.payload_json,'$.sourceId') AND status='pending')
 THEN RAISE(ABORT,'relation source is not pending') END;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_assembly_operation_apply AFTER INSERT ON catalog_assembly_operations
BEGIN
 INSERT INTO catalog_assembly_managed_series(hose_series,relation_version)
 SELECT NEW.hose_series,1 WHERE NEW.kind IN ('apply','manual','reject','delete') AND NEW.hose_series<>''
 ON CONFLICT(hose_series) DO UPDATE SET relation_version=relation_version+1;
 INSERT INTO catalog_assembly_managed_series(hose_series,generation_id,generated_relation_version)
 SELECT NEW.hose_series,NEW.id,NEW.expected_relation_version WHERE NEW.kind='generate'
 ON CONFLICT(hose_series) DO UPDATE SET generation_id=NEW.id,generated_relation_version=NEW.expected_relation_version;
 UPDATE catalog_item_assembly_state SET generated_sequence=NEW.expected_sequence
 WHERE hose_series=NEW.hose_series AND NEW.kind='generate';
 INSERT INTO catalog_assembly_manual(identity,hose_series,payload_json,operation_id)
 SELECT json_extract(NEW.payload_json,'$.combination.identity'),NEW.hose_series,json_extract(NEW.payload_json,'$.combination'),NEW.id WHERE NEW.kind='manual';
 INSERT INTO catalog_assembly_exclusions(identity,disabled,operation_id)
 SELECT value,NEW.kind='disable',NEW.id FROM json_each(NEW.payload_json,'$.identities') WHERE NEW.kind IN ('disable','enable')
 ON CONFLICT(identity) DO UPDATE SET disabled=excluded.disabled,operation_id=NEW.id;
 INSERT INTO catalog_assembly_relation_overrides(identity,hose_series,payload_json,operation_id)
 SELECT json_extract(NEW.payload_json,'$.endpointIdentity'),NEW.hose_series,json_extract(NEW.payload_json,'$.endpoint'),NEW.id WHERE NEW.kind='apply'
 ON CONFLICT(identity) DO UPDATE SET payload_json=excluded.payload_json,operation_id=NEW.id,hose_series=NEW.hose_series;
 UPDATE catalog_pending_relation_sources SET status=CASE NEW.kind WHEN 'apply' THEN 'applied' WHEN 'reject' THEN 'rejected' ELSE 'deleted' END,
 disposition_json=json_object('operationId',NEW.id,'actorId',NEW.actor_id,'reason',json_extract(NEW.payload_json,'$.reason'))
 WHERE id=json_extract(NEW.payload_json,'$.sourceId') AND NEW.kind IN ('apply','reject','delete');
 INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
 VALUES ('assembly:'||NEW.id,'assembly.'||NEW.kind,'assembly_operation',NEW.id,NEW.actor_id,
 json_object('hoseSeries',NEW.hose_series,'requestId',NEW.id,'ipAddress',NEW.ip_address,'data',json(NEW.payload_json)),NEW.occurred_at);
END;
CREATE TRIGGER catalog_assembly_operation_no_update BEFORE UPDATE ON catalog_assembly_operations
BEGIN SELECT RAISE(ABORT,'assembly history is immutable'); END;
CREATE TRIGGER catalog_assembly_operation_no_delete BEFORE DELETE ON catalog_assembly_operations
BEGIN SELECT RAISE(ABORT,'assembly history is immutable'); END;
--> statement-breakpoint
CREATE VIEW catalog_assembly_pending_series AS
SELECT hose_series FROM catalog_item_assembly_state WHERE invalidated_sequence>generated_sequence
UNION SELECT hose_series FROM catalog_assembly_managed_series WHERE relation_version>generated_relation_version;
DROP VIEW catalog_item_unavailable_hoses;
CREATE VIEW catalog_item_unavailable_hoses AS
SELECT h.sku FROM catalog_runtime_hose_variants h
JOIN catalog_item_publication_state state ON state.mode='items'
JOIN catalog_releases baseline ON baseline.id=state.baseline_release_id AND baseline.source_import_id=h.import_id
JOIN catalog_runtime_skus sku ON sku.import_id=h.import_id AND sku.sku=h.sku
WHERE h.hose_series IN (SELECT hose_series FROM catalog_assembly_pending_series)
OR sku.catalog_publication_status<>'Published' OR sku.rfq_eligibility<>'Eligible' OR sku.supply_availability<>'available_for_quote';
--> statement-breakpoint
CREATE VIEW catalog_assembly_generated_endpoints AS
SELECT r.source_import_id AS import_id, e.value AS payload_json
FROM catalog_assembly_managed_series s JOIN catalog_assembly_operations o ON o.id=s.generation_id,
json_each(o.payload_json,'$.endpoints') e
JOIN catalog_item_publication_state state ON state.mode='items'
JOIN catalog_releases r ON r.id=state.baseline_release_id;
CREATE VIEW catalog_assembly_current_combinations AS
WITH endpoints AS (
 SELECT s.hose_series,s.generation_id,e.value AS endpoint
 FROM catalog_assembly_managed_series s JOIN catalog_assembly_operations o ON o.id=s.generation_id,
 json_each(o.payload_json,'$.endpoints') e
), pairs AS (
 SELECT a.hose_series,a.generation_id,
 json_array(json_extract(a.endpoint,'$.hose_sku'),json_extract(a.endpoint,'$.hose_end_sku'),json_extract(a.endpoint,'$.ferrule_sku'),json_extract(b.endpoint,'$.hose_end_sku'),json_extract(b.endpoint,'$.ferrule_sku')) AS identity,
 json_object('hoseSku',json_extract(a.endpoint,'$.hose_sku'),'hoseSeries',a.hose_series,
 'endAHoseEndSku',json_extract(a.endpoint,'$.hose_end_sku'),'endAFerruleSku',json_extract(a.endpoint,'$.ferrule_sku'),
 'endBHoseEndSku',json_extract(b.endpoint,'$.hose_end_sku'),'endBFerruleSku',json_extract(b.endpoint,'$.ferrule_sku'),
 'endACompatibilityId',json_extract(a.endpoint,'$.compatibility_id'),'endBCompatibilityId',json_extract(b.endpoint,'$.compatibility_id'),
 'source',CASE WHEN json_extract(a.endpoint,'$.source')='import' OR json_extract(b.endpoint,'$.source')='import' THEN 'import' ELSE json_extract(a.endpoint,'$.source') END) AS payload_json
 FROM endpoints a JOIN endpoints b ON b.generation_id=a.generation_id AND json_extract(b.endpoint,'$.hose_sku')=json_extract(a.endpoint,'$.hose_sku')
)
SELECT identity,hose_series,json_set(payload_json,'$.identity',identity) AS payload_json,generation_id FROM pairs p
WHERE NOT EXISTS (SELECT 1 FROM catalog_assembly_manual m WHERE m.identity=p.identity)
UNION ALL SELECT m.identity,COALESCE(h.hose_series,m.hose_series),json_set(m.payload_json,'$.hoseSeries',COALESCE(h.hose_series,m.hose_series)),m.operation_id
FROM catalog_assembly_manual m LEFT JOIN catalog_item_publication_state state ON state.mode='items'
LEFT JOIN catalog_releases r ON r.id=state.baseline_release_id
LEFT JOIN catalog_runtime_hose_variants h ON h.import_id=r.source_import_id AND h.sku=json_extract(m.payload_json,'$.hoseSku');
--> statement-breakpoint
CREATE VIEW catalog_runtime_compatibilities AS
SELECT c.* FROM catalog_compatibilities c WHERE NOT EXISTS (SELECT 1 FROM catalog_assembly_managed_series s JOIN catalog_runtime_hose_variants h ON h.hose_series=s.hose_series AND h.sku=c.hose_sku AND h.import_id=c.import_id JOIN catalog_item_publication_state state ON state.mode='items' JOIN catalog_releases r ON r.id=state.baseline_release_id AND r.source_import_id=c.import_id WHERE s.generation_id IS NOT NULL)
UNION ALL SELECT json_extract(g.payload_json,'$.id'),
g.import_id,
json_extract(g.payload_json,'$.compatibility_id'),
json_extract(g.payload_json,'$.hose_sku'),
json_extract(g.payload_json,'$.hose_end_sku'),
json_extract(g.payload_json,'$.ferrule_sku'),
json_extract(g.payload_json,'$.assembly_method'),
json_extract(g.payload_json,'$.skive_requirement'),
json_extract(g.payload_json,'$.outer_skive_length_mm'),
json_extract(g.payload_json,'$.inner_skive_length_mm'),
json_extract(g.payload_json,'$.insertion_depth_mm'),
json_extract(g.payload_json,'$.crimp_program'),
json_extract(g.payload_json,'$.final_crimp_diameter_mm'),
json_extract(g.payload_json,'$.tolerance_mm'),
json_extract(g.payload_json,'$.measurement_location'),
json_extract(g.payload_json,'$.assembly_working_bar'),
json_extract(g.payload_json,'$.proof_pressure_bar'),
json_extract(g.payload_json,'$.proof_hold_seconds'),
json_extract(g.payload_json,'$.qualification_id'),
json_extract(g.payload_json,'$.qualification_status'),
json_extract(g.payload_json,'$.rfq_eligibility'),
json_extract(g.payload_json,'$.reference_system'),
json_extract(g.payload_json,'$.reference_hose_code'),
json_extract(g.payload_json,'$.reference_assembly_method'),
json_extract(g.payload_json,'$.reference_crimp_diameter_mm'),
json_extract(g.payload_json,'$.reference_tolerance_mm'),
json_extract(g.payload_json,'$.reference_source'),
json_extract(g.payload_json,'$.notes'),
json_extract(g.payload_json,'$.technical_data_status'),
json_extract(g.payload_json,'$.production_approval_status'),
json_extract(g.payload_json,'$.catalog_publication_status') FROM catalog_assembly_generated_endpoints g;
--> statement-breakpoint
UPDATE application_schema_state SET version=58,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
--> statement-breakpoint
CREATE VIEW catalog_runtime_assembly_combinations AS
SELECT r.id AS release_id,c.identity,c.hose_series,
 json_extract(c.payload_json,'$.hoseSku') AS hose_sku,
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=r.source_import_id AND e.hose_sku=json_extract(c.payload_json,'$.hoseSku') AND e.hose_end_sku=json_extract(c.payload_json,'$.endAHoseEndSku') AND e.ferrule_sku=json_extract(c.payload_json,'$.endAFerruleSku')) AS end_a_compatibility_id,
 json_extract(c.payload_json,'$.endAHoseEndSku') AS end_a_hose_end_sku,
 json_extract(c.payload_json,'$.endAFerruleSku') AS end_a_ferrule_sku,
 (SELECT e.compatibility_id FROM catalog_runtime_compatibilities e WHERE e.import_id=r.source_import_id AND e.hose_sku=json_extract(c.payload_json,'$.hoseSku') AND e.hose_end_sku=json_extract(c.payload_json,'$.endBHoseEndSku') AND e.ferrule_sku=json_extract(c.payload_json,'$.endBFerruleSku')) AS end_b_compatibility_id,
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
 AND a.compatibility_id=c.end_a_compatibility_id AND a.hose_end_sku=c.end_a_hose_end_sku AND a.ferrule_sku=c.end_a_ferrule_sku
JOIN catalog_runtime_compatibilities b ON b.import_id=r.source_import_id AND b.hose_sku=c.hose_sku
 AND b.compatibility_id=c.end_b_compatibility_id AND b.hose_end_sku=c.end_b_hose_end_sku AND b.ferrule_sku=c.end_b_ferrule_sku
WHERE r.status IN ('published','superseded')
AND a.catalog_publication_status='Published' AND a.rfq_eligibility='Eligible'
AND b.catalog_publication_status='Published' AND b.rfq_eligibility='Eligible'
AND NOT EXISTS (SELECT 1 FROM catalog_item_unavailable_hoses h WHERE h.sku=c.hose_sku)
AND (SELECT COUNT(*) FROM catalog_runtime_skus p WHERE p.import_id=r.source_import_id
 AND p.sku IN (c.hose_sku,c.end_a_hose_end_sku,c.end_a_ferrule_sku,c.end_b_hose_end_sku,c.end_b_ferrule_sku)
 AND p.catalog_publication_status='Published' AND p.rfq_eligibility='Eligible' AND p.supply_availability='available_for_quote')
 = (SELECT COUNT(DISTINCT value) FROM json_each(c.identity));

--> statement-breakpoint
CREATE TRIGGER catalog_assembly_enable_guard BEFORE INSERT ON catalog_assembly_operations
WHEN NEW.kind='enable'
BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload_json,'$.identities') i
 WHERE NOT EXISTS (SELECT 1 FROM catalog_valid_assembly_combinations c
 JOIN catalog_item_publication_state state ON state.mode='items' AND state.baseline_release_id=c.release_id
 WHERE c.identity=i.value AND c.end_a_compatibility_id IS NOT NULL AND c.end_b_compatibility_id IS NOT NULL
 AND c.hose_series NOT IN (SELECT hose_series FROM catalog_assembly_pending_series)))
 THEN RAISE(ABORT,'assembly is not ready') END;
END;

--> statement-breakpoint
CREATE VIEW catalog_available_assembly_combinations AS SELECT c.* FROM catalog_valid_assembly_combinations c WHERE NOT EXISTS (SELECT 1 FROM catalog_assembly_exclusions x JOIN catalog_item_publication_state state ON state.mode='items' AND state.baseline_release_id=c.release_id WHERE x.identity=c.identity AND x.disabled=1);

--> statement-breakpoint
-- A proposed source changes generation inputs, but does not take existing combinations offline.
CREATE TRIGGER catalog_assembly_pending_source_input AFTER INSERT ON catalog_pending_relation_sources
BEGIN
 INSERT INTO catalog_assembly_managed_series(hose_series,relation_version,generated_relation_version)
 SELECT h.hose_series,1,1 FROM catalog_runtime_hose_variants h
 JOIN catalog_item_publication_state state ON state.mode='items'
 JOIN catalog_releases r ON r.id=state.baseline_release_id AND r.source_import_id=h.import_id
 WHERE h.sku=json_extract(NEW.source_json,'$.values.hoseSku')
 ON CONFLICT(hose_series) DO UPDATE SET relation_version=relation_version+1,generated_relation_version=generated_relation_version+1;
END;
CREATE INDEX catalog_assembly_operation_series ON catalog_assembly_operations(hose_series,occurred_at);
CREATE INDEX catalog_assembly_manual_series ON catalog_assembly_manual(hose_series);
CREATE INDEX catalog_assembly_relation_series ON catalog_assembly_relation_overrides(hose_series);
