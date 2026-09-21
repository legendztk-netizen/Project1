-- The approved deletion request must not first become a terminal deleted request.
DROP TRIGGER catalog_item_revision_apply;
CREATE TRIGGER catalog_item_revision_apply AFTER INSERT ON catalog_product_revisions
WHEN COALESCE(json_extract(NEW.source_json,'$.bootstrap'),0)!=1
BEGIN
  UPDATE catalog_product_entities SET
    current_revision_id = CASE WHEN NEW.target_state <> 'draft' THEN NEW.id ELSE current_revision_id END,
    draft_revision_id = CASE WHEN NEW.target_state = 'draft' THEN NEW.id ELSE NULL END
  WHERE id = NEW.entity_id;
  UPDATE catalog_product_entities SET hidden_at=NEW.occurred_at WHERE id=NEW.entity_id AND json_extract(NEW.source_json, '$.operation')='delete';
  UPDATE catalog_product_change_requests SET status='deleted'
    WHERE status='pending' AND id IS NOT NEW.request_id AND json_extract(NEW.source_json,'$.operation')='delete'
      AND json_extract(payload_json,'$.payload.kind')='sku'
      AND json_extract(payload_json,'$.payload.productType')=(SELECT product_type FROM catalog_product_entities WHERE id=NEW.entity_id)
      AND json_extract(payload_json,'$.payload.variant.sku')=(SELECT code FROM catalog_product_entities WHERE id=NEW.entity_id);
  UPDATE catalog_item_publication_state SET generation = generation + 1 WHERE singleton = 1;
  INSERT INTO catalog_item_assembly_state(hose_series, invalidated_sequence)
    SELECT value, NEW.sequence FROM json_each(NEW.affected_series_json) WHERE NEW.target_state <> 'draft'
    ON CONFLICT(hose_series) DO UPDATE SET invalidated_sequence = excluded.invalidated_sequence;
  UPDATE catalog_product_change_requests SET status = 'approved', applied_revision_id = NEW.id
    WHERE id = NEW.request_id;
  INSERT INTO admin_audit_events(id, event_type, entity_type, entity_id, actor_id, payload_json, occurred_at)
    VALUES ('catalog-item:' || NEW.id, 'catalog_item.applied', 'product_revision', NEW.id, NEW.actor_id,
      json_object('source', json(NEW.source_json), 'targetState', NEW.target_state,
        'entityId', NEW.entity_id, 'baselineRevisionId', NEW.baseline_revision_id,
        'previousRevisionId', NEW.previous_revision_id, 'sequence', NEW.sequence,
        'affectedSeries', json(NEW.affected_series_json), 'requestId', NEW.request_id,
        'commandId', NEW.command_id, 'ipAddress', NEW.ip_address), NEW.occurred_at);
END;
--> statement-breakpoint
-- Recheck operation semantics in the atomic relation-application transaction.
CREATE TRIGGER catalog_relation_import_operation_guard BEFORE INSERT ON catalog_assembly_operations
WHEN NEW.kind='apply'
BEGIN
 SELECT CASE WHEN (SELECT json_extract(source_json,'$.values.updateDelete') FROM catalog_pending_relation_sources WHERE id=json_extract(NEW.payload_json,'$.sourceId'))='Update'
 AND (EXISTS (SELECT 1 FROM catalog_assembly_relation_overrides WHERE json_extract(payload_json,'$.compatibility_id')=json_extract(NEW.payload_json,'$.endpoint.compatibility_id'))
 OR EXISTS (SELECT 1 FROM catalog_runtime_compatibilities c JOIN catalog_releases r ON r.source_import_id=c.import_id JOIN catalog_item_publication_state s ON s.baseline_release_id=r.id WHERE c.compatibility_id=json_extract(NEW.payload_json,'$.endpoint.compatibility_id')))
 THEN RAISE(ABORT,'import relation already exists') END;
 SELECT CASE WHEN (SELECT json_extract(source_json,'$.values.updateDelete') FROM catalog_pending_relation_sources WHERE id=json_extract(NEW.payload_json,'$.sourceId')) IN ('PartialUpdate','Delete')
 AND EXISTS (SELECT 1 FROM catalog_assembly_relation_overrides WHERE json_extract(payload_json,'$.compatibility_id')=json_extract(NEW.payload_json,'$.endpoint.compatibility_id') AND json_extract(payload_json,'$.import_deleted')=1)
 THEN RAISE(ABORT,'import relation was deleted') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=75, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
