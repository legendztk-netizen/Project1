-- Every mutation to draft content advances the release revision used by the
-- publication compare-and-swap guard. Published and superseded content is
-- immutable at the database boundary.

CREATE TRIGGER `catalogskus_immutable_update`
BEFORE UPDATE ON `catalog_skus`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogskus_immutable_delete`
BEFORE DELETE ON `catalog_skus`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogskus_draft_insert_revision`
AFTER INSERT ON `catalog_skus`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogskus_draft_update_revision`
AFTER UPDATE ON `catalog_skus`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogskus_draft_delete_revision`
AFTER DELETE ON `catalog_skus`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `cataloghoseseries_immutable_update`
BEFORE UPDATE ON `catalog_hose_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_immutable_delete`
BEFORE DELETE ON `catalog_hose_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_draft_insert_revision`
AFTER INSERT ON `catalog_hose_series`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_draft_update_revision`
AFTER UPDATE ON `catalog_hose_series`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_draft_delete_revision`
AFTER DELETE ON `catalog_hose_series`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `cataloghosevariants_immutable_update`
BEFORE UPDATE ON `catalog_hose_variants`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_immutable_delete`
BEFORE DELETE ON `catalog_hose_variants`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_draft_insert_revision`
AFTER INSERT ON `catalog_hose_variants`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_draft_update_revision`
AFTER UPDATE ON `catalog_hose_variants`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_draft_delete_revision`
AFTER DELETE ON `catalog_hose_variants`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `cataloghoseends_immutable_update`
BEFORE UPDATE ON `catalog_hose_ends`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_immutable_delete`
BEFORE DELETE ON `catalog_hose_ends`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_draft_insert_revision`
AFTER INSERT ON `catalog_hose_ends`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_draft_update_revision`
AFTER UPDATE ON `catalog_hose_ends`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_draft_delete_revision`
AFTER DELETE ON `catalog_hose_ends`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogferrules_immutable_update`
BEFORE UPDATE ON `catalog_ferrules`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogferrules_immutable_delete`
BEFORE DELETE ON `catalog_ferrules`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogferrules_draft_insert_revision`
AFTER INSERT ON `catalog_ferrules`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogferrules_draft_update_revision`
AFTER UPDATE ON `catalog_ferrules`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogferrules_draft_delete_revision`
AFTER DELETE ON `catalog_ferrules`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogcompatibilities_immutable_update`
BEFORE UPDATE ON `catalog_compatibilities`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_immutable_delete`
BEFORE DELETE ON `catalog_compatibilities`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_draft_insert_revision`
AFTER INSERT ON `catalog_compatibilities`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_draft_update_revision`
AFTER UPDATE ON `catalog_compatibilities`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_draft_delete_revision`
AFTER DELETE ON `catalog_compatibilities`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogadapterfamilies_immutable_update`
BEFORE UPDATE ON `catalog_adapter_families`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapterfamilies_immutable_delete`
BEFORE DELETE ON `catalog_adapter_families`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapterfamilies_draft_insert_revision`
AFTER INSERT ON `catalog_adapter_families`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapterfamilies_draft_update_revision`
AFTER UPDATE ON `catalog_adapter_families`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapterfamilies_draft_delete_revision`
AFTER DELETE ON `catalog_adapter_families`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogadapters_immutable_update`
BEFORE UPDATE ON `catalog_adapters`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapters_immutable_delete`
BEFORE DELETE ON `catalog_adapters`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapters_draft_insert_revision`
AFTER INSERT ON `catalog_adapters`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapters_draft_update_revision`
AFTER UPDATE ON `catalog_adapters`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogadapters_draft_delete_revision`
AFTER DELETE ON `catalog_adapters`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogquickcouplers_immutable_update`
BEFORE UPDATE ON `catalog_quick_couplers`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogquickcouplers_immutable_delete`
BEFORE DELETE ON `catalog_quick_couplers`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogquickcouplers_draft_insert_revision`
AFTER INSERT ON `catalog_quick_couplers`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogquickcouplers_draft_update_revision`
AFTER UPDATE ON `catalog_quick_couplers`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogquickcouplers_draft_delete_revision`
AFTER DELETE ON `catalog_quick_couplers`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogsalesoffers_immutable_update`
BEFORE UPDATE ON `catalog_sales_offers`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogsalesoffers_immutable_delete`
BEFORE DELETE ON `catalog_sales_offers`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogsalesoffers_draft_insert_revision`
AFTER INSERT ON `catalog_sales_offers`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogsalesoffers_draft_update_revision`
AFTER UPDATE ON `catalog_sales_offers`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogsalesoffers_draft_delete_revision`
AFTER DELETE ON `catalog_sales_offers`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogcostbases_immutable_update`
BEFORE UPDATE ON `catalog_cost_bases`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcostbases_immutable_delete`
BEFORE DELETE ON `catalog_cost_bases`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcostbases_draft_insert_revision`
AFTER INSERT ON `catalog_cost_bases`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcostbases_draft_update_revision`
AFTER UPDATE ON `catalog_cost_bases`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcostbases_draft_delete_revision`
AFTER DELETE ON `catalog_cost_bases`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

CREATE TRIGGER `catalogimports_immutable_update`
BEFORE UPDATE ON `catalog_imports`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogimports_immutable_delete`
BEFORE DELETE ON `catalog_imports`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogimports_draft_update_revision`
AFTER UPDATE ON `catalog_imports`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogvalidations_immutable_update`
BEFORE UPDATE ON `catalog_import_validation_results`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogvalidations_immutable_delete`
BEFORE DELETE ON `catalog_import_validation_results`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogvalidations_draft_insert_revision`
AFTER INSERT ON `catalog_import_validation_results`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogvalidations_draft_update_revision`
AFTER UPDATE ON `catalog_import_validation_results`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogvalidations_draft_delete_revision`
AFTER DELETE ON `catalog_import_validation_results`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogpublications_immutable_update`
BEFORE UPDATE ON `catalog_release_publications`
BEGIN
  SELECT RAISE(ABORT, 'catalog publication history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogpublications_immutable_delete`
BEFORE DELETE ON `catalog_release_publications`
BEGIN
  SELECT RAISE(ABORT, 'catalog publication history is immutable');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 7, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;

