CREATE TABLE catalog_item_import_batches (
 id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_size_bytes INTEGER NOT NULL,
 original_json TEXT NOT NULL CHECK(json_valid(original_json)), issues_json TEXT NOT NULL CHECK(json_valid(issues_json)),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE catalog_product_change_requests ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE catalog_product_change_requests ADD COLUMN issues_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(issues_json));
ALTER TABLE catalog_product_change_requests ADD COLUMN batch_id TEXT REFERENCES catalog_item_import_batches(id);
ALTER TABLE catalog_product_change_requests ADD COLUMN baseline_json TEXT CHECK(baseline_json IS NULL OR json_valid(baseline_json));
CREATE INDEX catalog_item_request_filter ON catalog_product_change_requests(status,batch_id,target_state);
CREATE TABLE catalog_pending_relation_sources (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES catalog_item_import_batches(id),
 source_json TEXT NOT NULL CHECK(json_valid(source_json)), issues_json TEXT NOT NULL CHECK(json_valid(issues_json)),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected','deleted')),
 disposition_json TEXT CHECK(disposition_json IS NULL OR json_valid(disposition_json)),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER catalog_request_version_guard BEFORE INSERT ON catalog_product_revisions
WHEN NEW.request_id IS NOT NULL BEGIN
 SELECT CASE WHEN (SELECT version FROM catalog_product_change_requests WHERE id=NEW.request_id)
 != COALESCE(json_extract(NEW.source_json,'$.reviewVersion'),1)
 THEN RAISE(ABORT,'Request changed; reload before approval') END;
 SELECT CASE WHEN (SELECT issues_json FROM catalog_product_change_requests WHERE id=NEW.request_id) != '[]'
 THEN RAISE(ABORT,'Request has unresolved import issues') END;
END;
CREATE TRIGGER catalog_request_original_immutable BEFORE UPDATE ON catalog_product_change_requests
WHEN NEW.original_json != OLD.original_json OR NEW.source_json != OLD.source_json
 OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at
 OR NEW.baseline_revision_id IS NOT OLD.baseline_revision_id OR NEW.baseline_json IS NOT OLD.baseline_json OR NEW.batch_id IS NOT OLD.batch_id
BEGIN SELECT RAISE(ABORT,'Original import and baseline are immutable'); END;
CREATE TRIGGER catalog_request_terminal_immutable BEFORE UPDATE ON catalog_product_change_requests
WHEN OLD.status != 'pending'
BEGIN SELECT RAISE(ABORT,'Reviewed request is read only'); END;
CREATE TRIGGER catalog_request_no_delete BEFORE DELETE ON catalog_product_change_requests
BEGIN SELECT RAISE(ABORT,'Retain request history'); END;
CREATE TRIGGER catalog_item_batch_no_update BEFORE UPDATE ON catalog_item_import_batches
BEGIN SELECT RAISE(ABORT,'Retain original workbook'); END;
CREATE TRIGGER catalog_item_batch_no_delete BEFORE DELETE ON catalog_item_import_batches
BEGIN SELECT RAISE(ABORT,'Retain original workbook'); END;
CREATE TRIGGER catalog_relation_no_delete BEFORE DELETE ON catalog_pending_relation_sources
BEGIN SELECT RAISE(ABORT,'Retain relation source history'); END;
CREATE TRIGGER catalog_relation_source_immutable BEFORE UPDATE ON catalog_pending_relation_sources
WHEN NEW.source_json != OLD.source_json OR NEW.batch_id != OLD.batch_id OR NEW.created_by != OLD.created_by OR NEW.created_at != OLD.created_at
BEGIN SELECT RAISE(ABORT,'Retain relation source history'); END;
UPDATE application_schema_state SET version=57 WHERE singleton=1;
