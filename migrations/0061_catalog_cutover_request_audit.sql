-- Preserve existing events; attribute each future transition to its own request.
ALTER TABLE catalog_cutover_runs ADD COLUMN audit_actor_id TEXT;
--> statement-breakpoint
ALTER TABLE catalog_cutover_runs ADD COLUMN audit_request_id TEXT;
--> statement-breakpoint
ALTER TABLE catalog_cutover_runs ADD COLUMN audit_ip_address TEXT;
--> statement-breakpoint
DROP TRIGGER catalog_cutover_freeze;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_freeze AFTER UPDATE ON catalog_cutover_runs BEGIN
 UPDATE catalog_cutover_control SET frozen=EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status IN('frozen','committing'));
 UPDATE catalog_cutover_control SET committed=1 WHERE NEW.status='committed';
 INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES('cutover:'||NEW.id||':'||NEW.status,'catalog_cutover.'||NEW.status,'catalog',NEW.id,COALESCE(NEW.audit_actor_id,NEW.actor_id),json_object('fingerprint',NEW.fingerprint,'epoch',NEW.expected_epoch,'requestId',NEW.audit_request_id,'ipAddress',NEW.audit_ip_address,'previousStatus',OLD.status,'status',NEW.status),CURRENT_TIMESTAMP);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_inventory_audit AFTER INSERT ON catalog_cutover_runs BEGIN
 INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES('cutover:'||NEW.id||':inventoried','catalog_cutover.inventoried','catalog',NEW.id,NEW.actor_id,json_object('fingerprint',NEW.fingerprint,'epoch',NEW.expected_epoch,'requestId',NEW.audit_request_id,'ipAddress',NEW.audit_ip_address,'status',NEW.status),NEW.created_at);
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=62,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
