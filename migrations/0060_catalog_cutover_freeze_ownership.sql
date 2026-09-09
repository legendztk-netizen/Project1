DROP TRIGGER catalog_cutover_run_guard;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_run_guard BEFORE UPDATE ON catalog_cutover_runs BEGIN
 SELECT CASE WHEN OLD.status IN('committed','cancelled') OR NEW.id!=OLD.id OR NEW.expected_epoch!=OLD.expected_epoch OR NEW.fingerprint!=OLD.fingerprint OR NEW.report_json!=OLD.report_json OR NEW.active_release_id!=OLD.active_release_id THEN RAISE(ABORT,'Cutover evidence is immutable') END;
 SELECT CASE WHEN NEW.status='frozen' AND (OLD.status!='inventoried' OR NEW.expected_epoch!=(SELECT epoch FROM catalog_cutover_control)) THEN RAISE(ABORT,'Catalog changed; inventory again') END;
 SELECT CASE WHEN NEW.status='committing' AND (OLD.status!='frozen' OR NEW.expected_epoch!=(SELECT epoch FROM catalog_cutover_control)) THEN RAISE(ABORT,'Freeze before cutover') END;
 SELECT CASE WHEN NEW.status='committed' AND OLD.status!='committing' THEN RAISE(ABORT,'Invalid cutover transition') END;
 SELECT CASE WHEN NEW.status='cancelled' AND OLD.status NOT IN('inventoried','frozen') THEN RAISE(ABORT,'Forward recovery required') END;
END;
--> statement-breakpoint
DROP TRIGGER catalog_cutover_freeze;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_freeze AFTER UPDATE ON catalog_cutover_runs BEGIN
 UPDATE catalog_cutover_control SET frozen=EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status IN('frozen','committing'));
 UPDATE catalog_cutover_control SET committed=1 WHERE NEW.status='committed';
 INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES('cutover:'||NEW.id||':'||NEW.status,'catalog_cutover.'||NEW.status,'catalog',NEW.id,NEW.actor_id,json_object('fingerprint',NEW.fingerprint,'epoch',NEW.expected_epoch),CURRENT_TIMESTAMP);
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=61,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
