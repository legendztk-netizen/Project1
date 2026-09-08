-- Reserve applied endpoint identifiers before generation, including concurrent cross-series applications.
CREATE UNIQUE INDEX catalog_assembly_relation_identifier
ON catalog_assembly_relation_overrides(json_extract(payload_json,'$.compatibility_id'));
--> statement-breakpoint
CREATE TRIGGER catalog_assembly_relation_identifier_guard BEFORE INSERT ON catalog_assembly_operations
WHEN NEW.kind='apply'
BEGIN
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM catalog_runtime_compatibilities c
  JOIN catalog_item_publication_state s ON s.mode='items'
  JOIN catalog_releases r ON r.id=s.baseline_release_id AND r.source_import_id=c.import_id
  WHERE c.compatibility_id=json_extract(NEW.payload_json,'$.endpoint.compatibility_id')
  AND json_array(c.hose_sku,c.hose_end_sku,c.ferrule_sku)<>json_extract(NEW.payload_json,'$.endpointIdentity')
 ) THEN RAISE(ABORT,'catalog_assembly_relation_identifier conflict') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=59,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
