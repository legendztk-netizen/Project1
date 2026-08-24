-- A published snapshot must reject additions as well as updates and deletes.

CREATE TRIGGER `catalogskus_immutable_insert`
BEFORE INSERT ON `catalog_skus`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_immutable_insert`
BEFORE INSERT ON `catalog_hose_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_immutable_insert`
BEFORE INSERT ON `catalog_hose_variants`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_immutable_insert`
BEFORE INSERT ON `catalog_hose_ends`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogferrules_immutable_insert`
BEFORE INSERT ON `catalog_ferrules`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_immutable_insert`
BEFORE INSERT ON `catalog_compatibilities`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapterfamilies_immutable_insert`
BEFORE INSERT ON `catalog_adapter_families`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapters_immutable_insert`
BEFORE INSERT ON `catalog_adapters`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogquickcouplers_immutable_insert`
BEFORE INSERT ON `catalog_quick_couplers`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogsalesoffers_immutable_insert`
BEFORE INSERT ON `catalog_sales_offers`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcostbases_immutable_insert`
BEFORE INSERT ON `catalog_cost_bases`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogvalidations_immutable_insert`
BEFORE INSERT ON `catalog_import_validation_results`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogreleases_immutable_published_update`
BEFORE UPDATE ON `catalog_releases`
WHEN OLD.`status` IN ('published', 'superseded')
  AND NOT (
    OLD.`status` = 'published'
    AND NEW.`status` = 'superseded'
    AND NEW.`id` IS OLD.`id`
    AND NEW.`release_number` IS OLD.`release_number`
    AND NEW.`source_import_id` IS OLD.`source_import_id`
    AND NEW.`version` IS OLD.`version`
    AND NEW.`created_at` IS OLD.`created_at`
    AND NEW.`published_at` IS OLD.`published_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'published catalog release is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogreleases_immutable_published_delete`
BEFORE DELETE ON `catalog_releases`
WHEN OLD.`status` IN ('published', 'superseded')
BEGIN
  SELECT RAISE(ABORT, 'published catalog release is immutable');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 8, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
