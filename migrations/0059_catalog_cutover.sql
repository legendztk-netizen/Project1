-- Explicit inventory/freeze/commit; installing this migration does not switch authority.
CREATE TABLE catalog_cutover_control(singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch INTEGER NOT NULL DEFAULT 0, frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN(0,1)), committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN(0,1)));
--> statement-breakpoint
INSERT INTO catalog_cutover_control(singleton) VALUES(1);
--> statement-breakpoint
CREATE TABLE catalog_cutover_runs(id TEXT PRIMARY KEY, expected_epoch INTEGER NOT NULL, active_release_id TEXT NOT NULL REFERENCES catalog_releases(id), fingerprint TEXT NOT NULL, report_json TEXT NOT NULL CHECK(json_valid(report_json)), status TEXT NOT NULL CHECK(status IN('inventoried','frozen','committing','committed','cancelled')), actor_id TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX catalog_cutover_one_frozen ON catalog_cutover_runs((1)) WHERE status IN('frozen','committing');
--> statement-breakpoint
CREATE TABLE catalog_cutover_records(source_key TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES catalog_cutover_runs(id), record_kind TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), content_hash TEXT NOT NULL, target_id TEXT);
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_record_immutable_update BEFORE UPDATE ON catalog_cutover_records BEGIN SELECT RAISE(ABORT,'Cutover evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_record_immutable_delete BEFORE DELETE ON catalog_cutover_records BEGIN SELECT RAISE(ABORT,'Cutover evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_run_guard BEFORE UPDATE ON catalog_cutover_runs BEGIN
 SELECT CASE WHEN OLD.status IN('committed','cancelled') OR NEW.id!=OLD.id OR NEW.expected_epoch!=OLD.expected_epoch OR NEW.fingerprint!=OLD.fingerprint OR NEW.report_json!=OLD.report_json OR NEW.active_release_id!=OLD.active_release_id THEN RAISE(ABORT,'Cutover evidence is immutable') END;
 SELECT CASE WHEN NEW.status='frozen' AND (OLD.status!='inventoried' OR NEW.expected_epoch!=(SELECT epoch FROM catalog_cutover_control)) THEN RAISE(ABORT,'Catalog changed; inventory again') END;
 SELECT CASE WHEN NEW.status='committing' AND OLD.status!='frozen' THEN RAISE(ABORT,'Freeze before cutover') END;
 SELECT CASE WHEN NEW.status='committed' AND OLD.status!='committing' THEN RAISE(ABORT,'Invalid cutover transition') END;
 SELECT CASE WHEN NEW.status='cancelled' AND OLD.status NOT IN('inventoried','frozen') THEN RAISE(ABORT,'Forward recovery required') END;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_freeze AFTER UPDATE ON catalog_cutover_runs BEGIN
 UPDATE catalog_cutover_control SET frozen=1 WHERE NEW.status='frozen';
 UPDATE catalog_cutover_control SET frozen=0 WHERE NEW.status IN('cancelled','committed');
 UPDATE catalog_cutover_control SET committed=1 WHERE NEW.status='committed';
 INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES('cutover:'||NEW.id||':'||NEW.status,'catalog_cutover.'||NEW.status,'catalog',NEW.id,NEW.actor_id,json_object('fingerprint',NEW.fingerprint,'epoch',NEW.expected_epoch),CURRENT_TIMESTAMP);
END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_imports_insert BEFORE INSERT ON catalog_imports
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_imports_insert AFTER INSERT ON catalog_imports BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_imports_update BEFORE UPDATE ON catalog_imports
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_imports_update AFTER UPDATE ON catalog_imports BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_imports_delete BEFORE DELETE ON catalog_imports
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_imports_delete AFTER DELETE ON catalog_imports BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_releases_insert BEFORE INSERT ON catalog_releases
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_releases_insert AFTER INSERT ON catalog_releases BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_releases_update BEFORE UPDATE ON catalog_releases
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_releases_update AFTER UPDATE ON catalog_releases BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_releases_delete BEFORE DELETE ON catalog_releases
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_releases_delete AFTER DELETE ON catalog_releases BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_compatibilities_insert BEFORE INSERT ON catalog_compatibilities
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_compatibilities_insert AFTER INSERT ON catalog_compatibilities BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_compatibilities_update BEFORE UPDATE ON catalog_compatibilities
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_compatibilities_update AFTER UPDATE ON catalog_compatibilities BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_compatibilities_delete BEFORE DELETE ON catalog_compatibilities
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_compatibilities_delete AFTER DELETE ON catalog_compatibilities BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_ferrules_insert BEFORE INSERT ON catalog_ferrules
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_ferrules_insert AFTER INSERT ON catalog_ferrules BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_ferrules_update BEFORE UPDATE ON catalog_ferrules
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_ferrules_update AFTER UPDATE ON catalog_ferrules BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_ferrules_delete BEFORE DELETE ON catalog_ferrules
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_ferrules_delete AFTER DELETE ON catalog_ferrules BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_ends_insert BEFORE INSERT ON catalog_hose_ends
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_ends_insert AFTER INSERT ON catalog_hose_ends BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_ends_update BEFORE UPDATE ON catalog_hose_ends
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_ends_update AFTER UPDATE ON catalog_hose_ends BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_ends_delete BEFORE DELETE ON catalog_hose_ends
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_ends_delete AFTER DELETE ON catalog_hose_ends BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_series_insert BEFORE INSERT ON catalog_hose_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_series_insert AFTER INSERT ON catalog_hose_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_series_update BEFORE UPDATE ON catalog_hose_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_series_update AFTER UPDATE ON catalog_hose_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_series_delete BEFORE DELETE ON catalog_hose_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_series_delete AFTER DELETE ON catalog_hose_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_variants_insert BEFORE INSERT ON catalog_hose_variants
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_variants_insert AFTER INSERT ON catalog_hose_variants BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_variants_update BEFORE UPDATE ON catalog_hose_variants
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_variants_update AFTER UPDATE ON catalog_hose_variants BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_variants_delete BEFORE DELETE ON catalog_hose_variants
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_variants_delete AFTER DELETE ON catalog_hose_variants BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_import_validation_results_insert BEFORE INSERT ON catalog_import_validation_results
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_import_validation_results_insert AFTER INSERT ON catalog_import_validation_results BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_import_validation_results_update BEFORE UPDATE ON catalog_import_validation_results
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_import_validation_results_update AFTER UPDATE ON catalog_import_validation_results BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_import_validation_results_delete BEFORE DELETE ON catalog_import_validation_results
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_import_validation_results_delete AFTER DELETE ON catalog_import_validation_results BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_skus_insert BEFORE INSERT ON catalog_skus
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_skus_insert AFTER INSERT ON catalog_skus BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_skus_update BEFORE UPDATE ON catalog_skus
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_skus_update AFTER UPDATE ON catalog_skus BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_skus_delete BEFORE DELETE ON catalog_skus
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_skus_delete AFTER DELETE ON catalog_skus BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_adapter_families_insert BEFORE INSERT ON catalog_adapter_families
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_adapter_families_insert AFTER INSERT ON catalog_adapter_families BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_adapter_families_update BEFORE UPDATE ON catalog_adapter_families
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_adapter_families_update AFTER UPDATE ON catalog_adapter_families BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_adapter_families_delete BEFORE DELETE ON catalog_adapter_families
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_adapter_families_delete AFTER DELETE ON catalog_adapter_families BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_adapters_insert BEFORE INSERT ON catalog_adapters
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_adapters_insert AFTER INSERT ON catalog_adapters BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_adapters_update BEFORE UPDATE ON catalog_adapters
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_adapters_update AFTER UPDATE ON catalog_adapters BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_adapters_delete BEFORE DELETE ON catalog_adapters
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_adapters_delete AFTER DELETE ON catalog_adapters BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_cost_bases_insert BEFORE INSERT ON catalog_cost_bases
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_cost_bases_insert AFTER INSERT ON catalog_cost_bases BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_cost_bases_update BEFORE UPDATE ON catalog_cost_bases
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_cost_bases_update AFTER UPDATE ON catalog_cost_bases BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_cost_bases_delete BEFORE DELETE ON catalog_cost_bases
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_cost_bases_delete AFTER DELETE ON catalog_cost_bases BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_quick_couplers_insert BEFORE INSERT ON catalog_quick_couplers
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_quick_couplers_insert AFTER INSERT ON catalog_quick_couplers BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_quick_couplers_update BEFORE UPDATE ON catalog_quick_couplers
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_quick_couplers_update AFTER UPDATE ON catalog_quick_couplers BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_quick_couplers_delete BEFORE DELETE ON catalog_quick_couplers
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_quick_couplers_delete AFTER DELETE ON catalog_quick_couplers BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_sales_offers_insert BEFORE INSERT ON catalog_sales_offers
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_sales_offers_insert AFTER INSERT ON catalog_sales_offers BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_sales_offers_update BEFORE UPDATE ON catalog_sales_offers
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_sales_offers_update AFTER UPDATE ON catalog_sales_offers BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_sales_offers_delete BEFORE DELETE ON catalog_sales_offers
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_sales_offers_delete AFTER DELETE ON catalog_sales_offers BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_active_release_insert BEFORE INSERT ON catalog_active_release
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_active_release_insert AFTER INSERT ON catalog_active_release BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_active_release_update BEFORE UPDATE ON catalog_active_release
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_active_release_update AFTER UPDATE ON catalog_active_release BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_active_release_delete BEFORE DELETE ON catalog_active_release
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_active_release_delete AFTER DELETE ON catalog_active_release BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_release_publications_insert BEFORE INSERT ON catalog_release_publications
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_release_publications_insert AFTER INSERT ON catalog_release_publications BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_release_publications_update BEFORE UPDATE ON catalog_release_publications
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_release_publications_update AFTER UPDATE ON catalog_release_publications BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_release_publications_delete BEFORE DELETE ON catalog_release_publications
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_release_publications_delete AFTER DELETE ON catalog_release_publications BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_registry_seed_templates_insert BEFORE INSERT ON configurator_registry_seed_templates
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_registry_seed_templates_insert AFTER INSERT ON configurator_registry_seed_templates BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_registry_seed_templates_update BEFORE UPDATE ON configurator_registry_seed_templates
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_registry_seed_templates_update AFTER UPDATE ON configurator_registry_seed_templates BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_registry_seed_templates_delete BEFORE DELETE ON configurator_registry_seed_templates
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_registry_seed_templates_delete AFTER DELETE ON configurator_registry_seed_templates BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_configurator_registry_entries_insert BEFORE INSERT ON catalog_configurator_registry_entries
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_configurator_registry_entries_insert AFTER INSERT ON catalog_configurator_registry_entries BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_configurator_registry_entries_update BEFORE UPDATE ON catalog_configurator_registry_entries
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_configurator_registry_entries_update AFTER UPDATE ON catalog_configurator_registry_entries BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_configurator_registry_entries_delete BEFORE DELETE ON catalog_configurator_registry_entries
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_configurator_registry_entries_delete AFTER DELETE ON catalog_configurator_registry_entries BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_global_registry_entries_insert BEFORE INSERT ON configurator_global_registry_entries
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_global_registry_entries_insert AFTER INSERT ON configurator_global_registry_entries BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_global_registry_entries_update BEFORE UPDATE ON configurator_global_registry_entries
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_global_registry_entries_update AFTER UPDATE ON configurator_global_registry_entries BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_global_registry_entries_delete BEFORE DELETE ON configurator_global_registry_entries
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_global_registry_entries_delete AFTER DELETE ON configurator_global_registry_entries BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_global_registry_entry_versions_insert BEFORE INSERT ON configurator_global_registry_entry_versions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_global_registry_entry_versions_insert AFTER INSERT ON configurator_global_registry_entry_versions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_global_registry_entry_versions_update BEFORE UPDATE ON configurator_global_registry_entry_versions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_global_registry_entry_versions_update AFTER UPDATE ON configurator_global_registry_entry_versions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_configurator_global_registry_entry_versions_delete BEFORE DELETE ON configurator_global_registry_entry_versions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_configurator_global_registry_entry_versions_delete AFTER DELETE ON configurator_global_registry_entry_versions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_lineages_insert BEFORE INSERT ON catalog_media_lineages
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_media_lineages_insert AFTER INSERT ON catalog_media_lineages BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_lineages_update BEFORE UPDATE ON catalog_media_lineages
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_media_lineages_update AFTER UPDATE ON catalog_media_lineages BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_lineages_delete BEFORE DELETE ON catalog_media_lineages
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_media_lineages_delete AFTER DELETE ON catalog_media_lineages BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_versions_insert BEFORE INSERT ON catalog_media_versions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_media_versions_insert AFTER INSERT ON catalog_media_versions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_versions_update BEFORE UPDATE ON catalog_media_versions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_media_versions_update AFTER UPDATE ON catalog_media_versions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_media_versions_delete BEFORE DELETE ON catalog_media_versions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_media_versions_delete AFTER DELETE ON catalog_media_versions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_main_images_insert BEFORE INSERT ON catalog_product_main_images
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_main_images_insert AFTER INSERT ON catalog_product_main_images BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_main_images_update BEFORE UPDATE ON catalog_product_main_images
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_main_images_update AFTER UPDATE ON catalog_product_main_images BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_main_images_delete BEFORE DELETE ON catalog_product_main_images
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_main_images_delete AFTER DELETE ON catalog_product_main_images BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_impact_analyses_insert BEFORE INSERT ON catalog_assembly_impact_analyses
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_impact_analyses_insert AFTER INSERT ON catalog_assembly_impact_analyses BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_impact_analyses_update BEFORE UPDATE ON catalog_assembly_impact_analyses
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_impact_analyses_update AFTER UPDATE ON catalog_assembly_impact_analyses BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_impact_analyses_delete BEFORE DELETE ON catalog_assembly_impact_analyses
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_impact_analyses_delete AFTER DELETE ON catalog_assembly_impact_analyses BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_derived_assembly_series_insert BEFORE INSERT ON catalog_derived_assembly_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_derived_assembly_series_insert AFTER INSERT ON catalog_derived_assembly_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_derived_assembly_series_update BEFORE UPDATE ON catalog_derived_assembly_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_derived_assembly_series_update AFTER UPDATE ON catalog_derived_assembly_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_derived_assembly_series_delete BEFORE DELETE ON catalog_derived_assembly_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_derived_assembly_series_delete AFTER DELETE ON catalog_derived_assembly_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_derived_assembly_combinations_insert BEFORE INSERT ON catalog_derived_assembly_combinations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_derived_assembly_combinations_insert AFTER INSERT ON catalog_derived_assembly_combinations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_derived_assembly_combinations_update BEFORE UPDATE ON catalog_derived_assembly_combinations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_derived_assembly_combinations_update AFTER UPDATE ON catalog_derived_assembly_combinations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_derived_assembly_combinations_delete BEFORE DELETE ON catalog_derived_assembly_combinations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_derived_assembly_combinations_delete AFTER DELETE ON catalog_derived_assembly_combinations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_regenerations_insert BEFORE INSERT ON catalog_assembly_regenerations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_regenerations_insert AFTER INSERT ON catalog_assembly_regenerations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_regenerations_update BEFORE UPDATE ON catalog_assembly_regenerations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_regenerations_update AFTER UPDATE ON catalog_assembly_regenerations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_regenerations_delete BEFORE DELETE ON catalog_assembly_regenerations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_regenerations_delete AFTER DELETE ON catalog_assembly_regenerations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_end_series_insert BEFORE INSERT ON catalog_hose_end_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_end_series_insert AFTER INSERT ON catalog_hose_end_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_end_series_update BEFORE UPDATE ON catalog_hose_end_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_end_series_update AFTER UPDATE ON catalog_hose_end_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_hose_end_series_delete BEFORE DELETE ON catalog_hose_end_series
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_hose_end_series_delete AFTER DELETE ON catalog_hose_end_series BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_series_commercial_rules_insert BEFORE INSERT ON catalog_series_commercial_rules
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_series_commercial_rules_insert AFTER INSERT ON catalog_series_commercial_rules BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_series_commercial_rules_update BEFORE UPDATE ON catalog_series_commercial_rules
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_series_commercial_rules_update AFTER UPDATE ON catalog_series_commercial_rules BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_series_commercial_rules_delete BEFORE DELETE ON catalog_series_commercial_rules
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_series_commercial_rules_delete AFTER DELETE ON catalog_series_commercial_rules BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_sku_price_packaging_insert BEFORE INSERT ON catalog_sku_price_packaging
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_sku_price_packaging_insert AFTER INSERT ON catalog_sku_price_packaging BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_sku_price_packaging_update BEFORE UPDATE ON catalog_sku_price_packaging
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_sku_price_packaging_update AFTER UPDATE ON catalog_sku_price_packaging BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_sku_price_packaging_delete BEFORE DELETE ON catalog_sku_price_packaging
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing')) OR (SELECT committed FROM catalog_cutover_control)=1
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_sku_price_packaging_delete AFTER DELETE ON catalog_sku_price_packaging BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_entities_insert BEFORE INSERT ON catalog_product_entities
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_entities_insert AFTER INSERT ON catalog_product_entities BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_entities_update BEFORE UPDATE ON catalog_product_entities
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_entities_update AFTER UPDATE ON catalog_product_entities BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_entities_delete BEFORE DELETE ON catalog_product_entities
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_entities_delete AFTER DELETE ON catalog_product_entities BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_revisions_insert BEFORE INSERT ON catalog_product_revisions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_revisions_insert AFTER INSERT ON catalog_product_revisions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_revisions_update BEFORE UPDATE ON catalog_product_revisions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_revisions_update AFTER UPDATE ON catalog_product_revisions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_revisions_delete BEFORE DELETE ON catalog_product_revisions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_revisions_delete AFTER DELETE ON catalog_product_revisions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_change_requests_insert BEFORE INSERT ON catalog_product_change_requests
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_change_requests_insert AFTER INSERT ON catalog_product_change_requests BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_change_requests_update BEFORE UPDATE ON catalog_product_change_requests
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_change_requests_update AFTER UPDATE ON catalog_product_change_requests BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_change_requests_delete BEFORE DELETE ON catalog_product_change_requests
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_change_requests_delete AFTER DELETE ON catalog_product_change_requests BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_deletions_insert BEFORE INSERT ON catalog_product_deletions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_deletions_insert AFTER INSERT ON catalog_product_deletions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_deletions_update BEFORE UPDATE ON catalog_product_deletions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_deletions_update AFTER UPDATE ON catalog_product_deletions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_product_deletions_delete BEFORE DELETE ON catalog_product_deletions
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_product_deletions_delete AFTER DELETE ON catalog_product_deletions BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_item_import_batches_insert BEFORE INSERT ON catalog_item_import_batches
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_item_import_batches_insert AFTER INSERT ON catalog_item_import_batches BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_item_import_batches_update BEFORE UPDATE ON catalog_item_import_batches
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_item_import_batches_update AFTER UPDATE ON catalog_item_import_batches BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_item_import_batches_delete BEFORE DELETE ON catalog_item_import_batches
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_item_import_batches_delete AFTER DELETE ON catalog_item_import_batches BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_pending_relation_sources_insert BEFORE INSERT ON catalog_pending_relation_sources
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_pending_relation_sources_insert AFTER INSERT ON catalog_pending_relation_sources BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_pending_relation_sources_update BEFORE UPDATE ON catalog_pending_relation_sources
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_pending_relation_sources_update AFTER UPDATE ON catalog_pending_relation_sources BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_pending_relation_sources_delete BEFORE DELETE ON catalog_pending_relation_sources
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_pending_relation_sources_delete AFTER DELETE ON catalog_pending_relation_sources BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_operations_insert BEFORE INSERT ON catalog_assembly_operations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_operations_insert AFTER INSERT ON catalog_assembly_operations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_operations_update BEFORE UPDATE ON catalog_assembly_operations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_operations_update AFTER UPDATE ON catalog_assembly_operations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_assembly_operations_delete BEFORE DELETE ON catalog_assembly_operations
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_assembly_operations_delete AFTER DELETE ON catalog_assembly_operations BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_item_publication_state_insert BEFORE INSERT ON catalog_item_publication_state
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_item_publication_state_insert AFTER INSERT ON catalog_item_publication_state BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_item_publication_state_update BEFORE UPDATE ON catalog_item_publication_state
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_item_publication_state_update AFTER UPDATE ON catalog_item_publication_state BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
CREATE TRIGGER cutover_guard_catalog_item_publication_state_delete BEFORE DELETE ON catalog_item_publication_state
WHEN ((SELECT frozen FROM catalog_cutover_control)=1 AND NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing'))
BEGIN SELECT RAISE(ABORT,'Catalog maintenance is frozen; legacy writes are closed'); END;
--> statement-breakpoint
CREATE TRIGGER cutover_epoch_catalog_item_publication_state_delete AFTER DELETE ON catalog_item_publication_state BEGIN UPDATE catalog_cutover_control SET epoch=epoch+1; END;
--> statement-breakpoint
DROP TRIGGER catalog_item_revision_precondition;
--> statement-breakpoint
CREATE TRIGGER catalog_item_revision_precondition BEFORE INSERT ON catalog_product_revisions
WHEN COALESCE(json_extract(NEW.source_json,'$.bootstrap'),0)!=1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM catalog_item_publication_state
    WHERE singleton = 1 AND mode = 'items' AND generation = NEW.expected_generation
  ) THEN RAISE(ABORT, 'catalog item generation changed') END;
  SELECT CASE WHEN NEW.request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM catalog_product_change_requests WHERE id = NEW.request_id AND status = 'pending'
  ) THEN RAISE(ABORT, 'catalog request is not pending') END;
  SELECT CASE WHEN NEW.request_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM catalog_product_change_requests request, json_each(request.dependencies_json) dependency
    LEFT JOIN catalog_product_change_requests parent ON parent.id = dependency.value
    WHERE request.id = NEW.request_id AND COALESCE(parent.status, '') <> 'approved'
  ) THEN RAISE(ABORT, 'catalog request dependency is not approved') END;
END;
--> statement-breakpoint
DROP TRIGGER catalog_item_revision_apply;
--> statement-breakpoint
CREATE TRIGGER catalog_item_revision_apply AFTER INSERT ON catalog_product_revisions
WHEN COALESCE(json_extract(NEW.source_json,'$.bootstrap'),0)!=1
BEGIN
  UPDATE catalog_product_entities SET
    current_revision_id = CASE WHEN NEW.target_state <> 'draft' THEN NEW.id ELSE current_revision_id END,
    draft_revision_id = CASE WHEN NEW.target_state = 'draft' THEN NEW.id ELSE NULL END
  WHERE id = NEW.entity_id;
  UPDATE catalog_product_entities SET hidden_at=NEW.occurred_at WHERE id=NEW.entity_id AND json_extract(NEW.source_json, '$.operation')='delete';
  UPDATE catalog_product_change_requests SET status='deleted'
    WHERE status='pending' AND json_extract(NEW.source_json,'$.operation')='delete'
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
CREATE TRIGGER catalog_cutover_revision_guard BEFORE INSERT ON catalog_product_revisions
WHEN json_extract(NEW.source_json,'$.bootstrap')=1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM catalog_cutover_runs WHERE status='committing' AND id=json_extract(NEW.source_json,'$.runId')) THEN RAISE(ABORT,'Bootstrap requires frozen cutover') END;
END;
--> statement-breakpoint
UPDATE application_schema_state SET version=60,updated_at=CURRENT_TIMESTAMP WHERE singleton=1;

--> statement-breakpoint
-- Baseline revisions carry identity and provenance; legacy views preserve every original field.
CREATE VIEW catalog_item_runtime_current AS SELECT n.* FROM catalog_item_current n JOIN catalog_product_revisions r ON r.id=n.revision_id WHERE COALESCE(json_extract(r.source_json,'$.bootstrap'),0)!=1;
--> statement-breakpoint
CREATE TRIGGER catalog_cutover_revision_pointer AFTER INSERT ON catalog_product_revisions
WHEN json_extract(NEW.source_json,'$.bootstrap')=1 BEGIN
 UPDATE catalog_product_entities SET current_revision_id=iif(NEW.target_state!='draft',NEW.id,NULL),draft_revision_id=iif(NEW.target_state='draft',NEW.id,NULL)
 WHERE id=NEW.entity_id AND current_revision_id IS NULL AND draft_revision_id IS NULL;
END;

--> statement-breakpoint
DROP VIEW catalog_runtime_skus;
--> statement-breakpoint
CREATE VIEW catalog_runtime_skus AS
SELECT old.* FROM catalog_skus old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       'manual-item' AS source_worksheet,
       n.product_type AS product_type,
       CASE n.product_type WHEN 'hose' THEN json_extract(n.payload_json, '$.variant.hoseSeries') WHEN 'hose_end' THEN json_extract(n.payload_json, '$.variant.fittingSeries') WHEN 'ferrule' THEN json_extract(n.payload_json, '$.variant.ferruleSeries') WHEN 'adapter' THEN json_extract(n.payload_json, '$.variant.adapterFamilyId') WHEN 'quick_coupler' THEN json_extract(n.payload_json, '$.variant.couplerSeries') END AS hose_series,
       CASE n.target_state WHEN 'online' THEN 'Published' WHEN 'draft' THEN 'Draft' ELSE 'Archived' END AS catalog_publication_status,
       CASE n.target_state WHEN 'online' THEN 'Eligible' ELSE 'Blocked' END AS rfq_eligibility,
       COALESCE(json_extract(n.payload_json,'$.variant.technicalDataStatus'),'Complete') AS technical_data_status,
       CASE n.target_state WHEN 'online' THEN 'available_for_quote' WHEN 'draft' THEN 'temporarily_unavailable' ELSE 'discontinued' END AS supply_availability
FROM catalog_item_runtime_current n

WHERE n.kind = 'sku';

--> statement-breakpoint
DROP VIEW catalog_runtime_hose_series;
--> statement-breakpoint
CREATE VIEW catalog_runtime_hose_series AS
SELECT old.* FROM catalog_hose_series old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'series' AND n.product_type = 'hose' AND n.import_id=old.import_id AND n.code=old.series_code)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS series_code,
       json_extract(n.payload_json, '$.series.seriesName') AS series_name,
       json_extract(n.payload_json, '$.series.primaryStandard') AS primary_standard,
       json_extract(n.payload_json, '$.series.equivalentStandard') AS equivalent_standard,
       json_extract(n.payload_json, '$.series.tempMinC') AS temp_min_c,
       json_extract(n.payload_json, '$.series.tempMaxC') AS temp_max_c,
       json_extract(n.payload_json, '$.series.tubeMaterial') AS tube_material,
       json_extract(n.payload_json, '$.series.reinforcement') AS reinforcement,
       json_extract(n.payload_json, '$.series.coverMaterial') AS cover_material,
       json_extract(n.payload_json, '$.series.coverColor') AS cover_color,
       json_extract(n.payload_json, '$.series.coverFinish') AS cover_finish,
       json_extract(n.payload_json, '$.series.fluidCompatibility') AS fluid_compatibility,
       n.media_version_id AS representative_media_version_id
FROM catalog_item_runtime_current n

WHERE n.kind = 'series' AND n.product_type = 'hose';

--> statement-breakpoint
DROP VIEW catalog_runtime_hose_end_series;
--> statement-breakpoint
CREATE VIEW catalog_runtime_hose_end_series AS
SELECT old.* FROM catalog_hose_end_series old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'series' AND n.product_type = 'hose_end' AND n.import_id=old.import_id AND n.code=old.series_code)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS series_code,
       json_extract(n.payload_json, '$.series.seriesName') AS series_name,
       json_extract(n.payload_json, '$.series.interfaceFamily') AS interface_family,
       json_extract(n.payload_json, '$.series.interfaceStandard') AS connection_standard,
       json_extract(n.payload_json, '$.series.gender') AS gender,
       json_extract(n.payload_json, '$.series.swivelForm') AS swivel_form,
       json_extract(n.payload_json, '$.series.angle') AS angle,
       json_extract(n.payload_json, '$.series.sealingForm') AS sealing_form,
       n.media_version_id AS representative_media_version_id
FROM catalog_item_runtime_current n

WHERE n.kind = 'series' AND n.product_type = 'hose_end';

--> statement-breakpoint
DROP VIEW catalog_runtime_hose_variants;
--> statement-breakpoint
CREATE VIEW catalog_runtime_hose_variants AS
SELECT old.* FROM catalog_hose_variants old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.hoseSeries') AS hose_series,
       series.primary_standard AS primary_standard,
       series.equivalent_standard AS equivalent_standard,
       json_extract(n.payload_json, '$.variant.dash') AS dash,
       json_extract(n.payload_json, '$.variant.nominalIdIn') AS nominal_id_in,
       json_extract(n.payload_json, '$.variant.idMm') AS id_mm,
       json_extract(n.payload_json, '$.variant.odMm') AS od_mm,
       json_extract(n.payload_json, '$.variant.workingBar') AS working_bar,
       json_extract(n.payload_json, '$.variant.workingPsi') AS working_psi,
       json_extract(n.payload_json, '$.variant.burstBar') AS burst_bar,
       json_extract(n.payload_json, '$.variant.bendRadiusMm') AS bend_radius_mm,
       json_extract(n.payload_json, '$.variant.weightKgM') AS weight_kg_m,
       series.temp_min_c AS temp_min_c,
       series.temp_max_c AS temp_max_c,
       series.tube_material AS tube_material,
       series.reinforcement AS reinforcement,
       series.cover_material AS cover_material,
       series.cover_color AS cover_color,
       series.cover_finish AS cover_finish,
       json_extract(n.payload_json, '$.variant.skiveRequirement') AS skive_requirement,
       json_extract(n.payload_json, '$.variant.mshaMarking') AS msha_marking,
       series.fluid_compatibility AS fluid_compatibility,
       NULL AS origin,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_runtime_current n
LEFT JOIN catalog_runtime_hose_series series ON series.import_id=n.import_id AND series.series_code=json_extract(n.payload_json,'$.variant.hoseSeries')
WHERE n.kind='sku' AND n.product_type='hose';

--> statement-breakpoint
DROP VIEW catalog_runtime_hose_ends;
--> statement-breakpoint
CREATE VIEW catalog_runtime_hose_ends AS
SELECT old.* FROM catalog_hose_ends old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.fittingSeries') AS fitting_series,
       json_extract(n.payload_json, '$.variant.competitorPartNumber') AS competitor_part_number,
       series.interface_family AS interface_family,
       series.connection_standard AS connection_standard,
       series.gender AS gender,
       series.swivel_form AS swivel_form,
       series.angle AS angle,
       series.sealing_form AS sealing_form,
       json_extract(n.payload_json, '$.variant.thread') AS thread,
       json_extract(n.payload_json, '$.variant.connectionDash') AS connection_dash,
       json_extract(n.payload_json, '$.variant.hoseTailDash') AS hose_tail_dash,
       json_extract(n.payload_json, '$.variant.material') AS material,
       json_extract(n.payload_json, '$.variant.coating') AS coating,
       json_extract(n.payload_json, '$.variant.saltSprayHours') AS salt_spray_hours,
       json_extract(n.payload_json, '$.variant.maxWorkingBar') AS max_working_bar,
       json_extract(n.payload_json, '$.variant.dimensionAMm') AS dimension_a_mm,
       json_extract(n.payload_json, '$.variant.cutoffBMm') AS cutoff_b_mm,
       json_extract(n.payload_json, '$.variant.hex1Mm') AS hex_1_mm,
       json_extract(n.payload_json, '$.variant.hex2Mm') AS hex_2_mm,
       json_extract(n.payload_json, '$.variant.minimumBoreMm') AS minimum_bore_mm,
       json_extract(n.payload_json, '$.variant.unitWeightG') AS unit_weight_g,
       json_extract(n.payload_json, '$.variant.drawingNumber') AS drawing_number,
       json_extract(n.payload_json, '$.variant.drawingRevision') AS drawing_revision,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_runtime_current n
LEFT JOIN catalog_runtime_hose_end_series series ON series.import_id=n.import_id AND series.series_code=json_extract(n.payload_json,'$.variant.fittingSeries')
WHERE n.kind='sku' AND n.product_type='hose_end';

--> statement-breakpoint
DROP VIEW catalog_runtime_ferrules;
--> statement-breakpoint
CREATE VIEW catalog_runtime_ferrules AS
SELECT old.* FROM catalog_ferrules old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.ferruleSeries') AS ferrule_series,
       json_extract(n.payload_json, '$.variant.hoseConstruction') AS hose_construction,
       json_extract(n.payload_json, '$.variant.hoseTailDash') AS hose_tail_dash,
       json_extract(n.payload_json, '$.variant.skiveRequirement') AS skive_requirement,
       json_extract(n.payload_json, '$.variant.material') AS material,
       json_extract(n.payload_json, '$.variant.coating') AS coating,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_runtime_current n

WHERE n.kind='sku' AND n.product_type='ferrule';

--> statement-breakpoint
DROP VIEW catalog_runtime_adapters;
--> statement-breakpoint
CREATE VIEW catalog_runtime_adapters AS
SELECT old.* FROM catalog_adapters old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.adapterFamilyId') AS adapter_family_id,
       json_extract(n.payload_json, '$.variant.skuTemplate') AS sku_template,
       json_extract(n.payload_json, '$.variant.catalogModel') AS catalog_model,
       json_extract(n.payload_json, '$.variant.websiteProductName') AS website_product_name,
       json_extract(n.payload_json, '$.variant.shapeCode') AS shape_code,
       json_extract(n.payload_json, '$.variant.interface1') AS interface_1,
       json_extract(n.payload_json, '$.variant.connectionForm1') AS connection_form_1,
       json_extract(n.payload_json, '$.variant.size1') AS size_1,
       json_extract(n.payload_json, '$.variant.interface2') AS interface_2,
       json_extract(n.payload_json, '$.variant.connectionForm2') AS connection_form_2,
       json_extract(n.payload_json, '$.variant.size2') AS size_2,
       json_extract(n.payload_json, '$.variant.interface3') AS interface_3,
       json_extract(n.payload_json, '$.variant.connectionForm3') AS connection_form_3,
       json_extract(n.payload_json, '$.variant.size3') AS size_3,
       json_extract(n.payload_json, '$.variant.websiteDisplay') AS website_display,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_runtime_current n

WHERE n.kind='sku' AND n.product_type='adapter';

--> statement-breakpoint
DROP VIEW catalog_runtime_quick_couplers;
--> statement-breakpoint
CREATE VIEW catalog_runtime_quick_couplers AS
SELECT old.* FROM catalog_quick_couplers old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       json_extract(n.payload_json, '$.variant.skuStandardCode') AS sku_standard_code,
       json_extract(n.payload_json, '$.variant.skuRoleCode') AS sku_role_code,
       json_extract(n.payload_json, '$.variant.bodyDash') AS body_dash,
       json_extract(n.payload_json, '$.variant.portCode') AS port_code,
       json_extract(n.payload_json, '$.variant.portDash') AS port_dash,
       json_extract(n.payload_json, '$.variant.couplerSeries') AS coupler_series,
       json_extract(n.payload_json, '$.variant.role') AS role,
       json_extract(n.payload_json, '$.variant.matingSeries') AS mating_series,
       json_extract(n.payload_json, '$.variant.interchangeStandard') AS interchange_standard,
       json_extract(n.payload_json, '$.variant.bodySize') AS body_size,
       json_extract(n.payload_json, '$.variant.portInterface') AS port_interface,
       json_extract(n.payload_json, '$.variant.portGender') AS port_gender,
       json_extract(n.payload_json, '$.variant.portThread') AS port_thread,
       json_extract(n.payload_json, '$.variant.connectionMechanism') AS connection_mechanism,
       json_extract(n.payload_json, '$.variant.valving') AS valving,
       json_extract(n.payload_json, '$.variant.bodyMaterial') AS body_material,
       json_extract(n.payload_json, '$.variant.coating') AS coating,
       json_extract(n.payload_json, '$.variant.sealMaterial') AS seal_material,
       json_extract(n.payload_json, '$.variant.maxWorkingBar') AS max_working_bar,
       json_extract(n.payload_json, '$.variant.minimumBurstBar') AS minimum_burst_bar,
       json_extract(n.payload_json, '$.variant.ratedFlowLMin') AS rated_flow_l_min,
       json_extract(n.payload_json, '$.variant.pressureDropBasis') AS pressure_drop_basis,
       json_extract(n.payload_json, '$.variant.tempMinC') AS temp_min_c,
       json_extract(n.payload_json, '$.variant.tempMaxC') AS temp_max_c,
       json_extract(n.payload_json, '$.variant.overallLengthMm') AS overall_length_mm,
       json_extract(n.payload_json, '$.variant.unitWeightG') AS unit_weight_g,
       json_extract(n.payload_json, '$.variant.drawingNumber') AS drawing_number,
       json_extract(n.payload_json, '$.variant.source') AS source,
       json_extract(n.payload_json, '$.variant.notes') AS notes
FROM catalog_item_runtime_current n

WHERE n.kind='sku' AND n.product_type='quick_coupler';

--> statement-breakpoint
DROP VIEW catalog_runtime_series_commercial_rules;
--> statement-breakpoint
CREATE VIEW catalog_runtime_series_commercial_rules AS
SELECT old.* FROM catalog_series_commercial_rules old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind='series' AND n.import_id=old.import_id AND n.product_type=old.product_type AND n.code=old.series_code)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.product_type AS product_type,
       n.code AS series_code,
       json_extract(n.payload_json,'$.commercialRule.salesUnit') AS sales_unit,
       json_extract(n.payload_json,'$.commercialRule.moq') AS moq,
       json_extract(n.payload_json,'$.commercialRule.leadTimeDays') AS lead_time_days,
       json_extract(n.payload_json,'$.commercialRule.countryOfOrigin') AS country_of_origin,
       json_extract(n.payload_json,'$.commercialRule.hsCode') AS hs_code,
       json_extract(n.payload_json,'$.commercialRule.notes') AS notes,
       json_extract(n.payload_json,'$.commercialRule.quantityInputMode') AS quantity_input_mode,
       json_extract(n.payload_json,'$.commercialRule.minimumLengthPerPieceFt') AS minimum_length_per_piece_ft,
       json_extract(n.payload_json,'$.commercialRule.lengthIncrementFt') AS length_increment_ft,
       json_extract(n.payload_json,'$.commercialRule.presetLength1Ft') AS preset_length_1_ft,
       json_extract(n.payload_json,'$.commercialRule.presetLength2Ft') AS preset_length_2_ft,
       json_extract(n.payload_json,'$.commercialRule.presetLength3Ft') AS preset_length_3_ft,
       json_extract(n.payload_json,'$.commercialRule.continuousLengthConfirmation') AS continuous_length_confirmation
FROM catalog_item_runtime_current n

WHERE n.kind='series';

--> statement-breakpoint
DROP VIEW catalog_runtime_sku_price_packaging;
--> statement-breakpoint
CREATE VIEW catalog_runtime_sku_price_packaging AS
SELECT old.* FROM catalog_sku_price_packaging old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       n.code AS sales_sku,
       json_extract(n.payload_json,'$.price.amount') AS reference_price_usd,
       json_extract(n.payload_json,'$.price.currency') AS currency,
       json_extract(n.payload_json,'$.price.packageLengthFt') AS package_length_ft,
       json_extract(n.payload_json,'$.price.unitsPerSalesPack') AS units_per_sales_pack,
       json_extract(n.payload_json,'$.price.netUnitWeightKg') AS net_unit_weight_kg,
       json_extract(n.payload_json,'$.price.innerPackQty') AS inner_pack_qty,
       json_extract(n.payload_json,'$.price.masterCartonQty') AS master_carton_qty,
       json_extract(n.payload_json,'$.price.cartonGrossWeightKg') AS carton_gross_weight_kg,
       json_extract(n.payload_json,'$.price.cartonLCm') AS carton_l_cm,
       json_extract(n.payload_json,'$.price.cartonWCm') AS carton_w_cm,
       json_extract(n.payload_json,'$.price.cartonHCm') AS carton_h_cm,
       json_extract(n.payload_json,'$.price.packingBasis') AS packing_basis
FROM catalog_item_runtime_current n

WHERE n.kind='sku';

--> statement-breakpoint
DROP VIEW catalog_runtime_sales_offers;
--> statement-breakpoint
CREATE VIEW catalog_runtime_sales_offers AS
SELECT old.* FROM catalog_sales_offers old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.base_sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS base_sku,
       n.code AS sales_sku,
       CASE n.product_type WHEN 'hose' THEN 'Hose Variant' WHEN 'hose_end' THEN 'Hose End' WHEN 'ferrule' THEN 'Ferrule' WHEN 'adapter' THEN 'Adapter' ELSE 'Quick Coupler' END AS product_type,
       rule.sales_unit AS sales_unit,
       json_extract(n.payload_json,'$.price.packageLengthFt') AS package_length_ft,
       json_extract(n.payload_json,'$.price.unitsPerSalesPack') AS units_per_sales_pack,
       rule.moq AS moq,
       json_extract(n.payload_json,'$.price.netUnitWeightKg') AS net_unit_weight_kg,
       rule.lead_time_days AS lead_time_days,
       rule.country_of_origin AS country_of_origin,
       json_extract(n.payload_json,'$.price.currency') AS currency,
       json_extract(n.payload_json,'$.price.amount') AS reference_price_usd,
       json_extract(n.payload_json,'$.price.innerPackQty') AS inner_pack_qty,
       json_extract(n.payload_json,'$.price.masterCartonQty') AS master_carton_qty,
       json_extract(n.payload_json,'$.price.cartonGrossWeightKg') AS carton_gross_weight_kg,
       json_extract(n.payload_json,'$.price.cartonLCm') AS carton_l_cm,
       json_extract(n.payload_json,'$.price.cartonWCm') AS carton_w_cm,
       json_extract(n.payload_json,'$.price.cartonHCm') AS carton_h_cm,
       json_extract(n.payload_json,'$.price.packingBasis') AS packing_basis,
       rule.hs_code AS hs_code,
       rule.notes AS notes,
       CASE n.target_state WHEN 'online' THEN 'Published' WHEN 'draft' THEN 'Draft' ELSE 'Archived' END AS catalog_publication_status,
       CASE n.target_state WHEN 'online' THEN 'Eligible' ELSE 'Blocked' END AS rfq_eligibility,
       COALESCE(json_extract(n.payload_json,'$.variant.technicalDataStatus'),'Complete') AS technical_data_status,
       rule.quantity_input_mode AS quantity_input_mode,
       rule.minimum_length_per_piece_ft AS minimum_length_per_piece_ft,
       rule.length_increment_ft AS length_increment_ft,
       rule.preset_length_1_ft AS preset_length_1_ft,
       rule.preset_length_2_ft AS preset_length_2_ft,
       rule.preset_length_3_ft AS preset_length_3_ft,
       rule.continuous_length_confirmation AS continuous_length_confirmation
FROM catalog_item_runtime_current n
LEFT JOIN catalog_runtime_series_commercial_rules rule ON rule.import_id=n.import_id AND rule.product_type=n.product_type AND rule.series_code=CASE n.product_type WHEN 'hose' THEN json_extract(n.payload_json, '$.variant.hoseSeries') WHEN 'hose_end' THEN json_extract(n.payload_json, '$.variant.fittingSeries') WHEN 'ferrule' THEN json_extract(n.payload_json, '$.variant.ferruleSeries') WHEN 'adapter' THEN json_extract(n.payload_json, '$.variant.adapterFamilyId') WHEN 'quick_coupler' THEN json_extract(n.payload_json, '$.variant.couplerSeries') END
WHERE n.kind='sku';

--> statement-breakpoint
DROP VIEW catalog_runtime_product_main_images;
--> statement-breakpoint
CREATE VIEW catalog_runtime_product_main_images AS
SELECT old.* FROM catalog_product_main_images old
WHERE NOT EXISTS (SELECT 1 FROM catalog_item_runtime_current n WHERE n.kind = 'sku' AND n.import_id = old.import_id AND n.code = old.sku)
UNION ALL
SELECT 'item:' || n.revision_id AS id,
       n.import_id AS import_id,
       n.code AS sku,
       n.media_version_id AS media_version_id,
       n.occurred_at AS assigned_at,
       n.actor_id AS assigned_by,
       'override' AS assignment_kind
FROM catalog_item_runtime_current n

WHERE n.kind='sku';

--> statement-breakpoint
CREATE TABLE catalog_release_creation_baselines(release_id TEXT PRIMARY KEY REFERENCES catalog_releases(id),baseline_release_id TEXT REFERENCES catalog_releases(id),active_version INTEGER NOT NULL,created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TRIGGER catalog_capture_draft_creation AFTER INSERT ON catalog_releases WHEN NEW.status='draft' BEGIN
 INSERT INTO catalog_release_creation_baselines(release_id,baseline_release_id,active_version,created_at) SELECT NEW.id,release_id,version,NEW.created_at FROM catalog_active_release WHERE singleton=1;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_creation_baseline_immutable_update BEFORE UPDATE ON catalog_release_creation_baselines BEGIN SELECT RAISE(ABORT,'Creation baseline is immutable'); END;
CREATE TRIGGER catalog_creation_baseline_immutable_delete BEFORE DELETE ON catalog_release_creation_baselines BEGIN SELECT RAISE(ABORT,'Creation baseline is immutable'); END;
