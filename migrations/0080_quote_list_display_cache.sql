-- Display-only results. RFQ submission always runs fresh validation.
CREATE TABLE quote_list_display_revision (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO quote_list_display_revision(singleton, version) VALUES (1, 1);
CREATE TABLE quote_line_display_cache (
  line_id TEXT PRIMARY KEY REFERENCES anonymous_quote_lines(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  data_version INTEGER NOT NULL,
  format_version INTEGER NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json))
);
--> statement-breakpoint
-- Existing cutover epochs cover publications, product inputs and configurator rules.
CREATE TRIGGER quote_display_catalog_epoch AFTER UPDATE ON catalog_cutover_control
WHEN NEW.epoch <> OLD.epoch
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_cutting_labeling_fee_rates_insert AFTER INSERT ON cutting_labeling_fee_rates
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_cutting_labeling_fee_rates_update AFTER UPDATE ON cutting_labeling_fee_rates
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_cutting_labeling_fee_rates_delete AFTER DELETE ON cutting_labeling_fee_rates
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_quote_reference_discounts_insert AFTER INSERT ON quote_reference_discounts
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_quote_reference_discounts_update AFTER UPDATE ON quote_reference_discounts
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_quote_reference_discounts_delete AFTER DELETE ON quote_reference_discounts
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_media_versions_insert AFTER INSERT ON catalog_media_versions
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_media_versions_update AFTER UPDATE ON catalog_media_versions
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_media_versions_delete AFTER DELETE ON catalog_media_versions
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_item_assembly_state_insert AFTER INSERT ON catalog_item_assembly_state
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_item_assembly_state_update AFTER UPDATE ON catalog_item_assembly_state
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_item_assembly_state_delete AFTER DELETE ON catalog_item_assembly_state
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_managed_series_insert AFTER INSERT ON catalog_assembly_managed_series
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_managed_series_update AFTER UPDATE ON catalog_assembly_managed_series
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_managed_series_delete AFTER DELETE ON catalog_assembly_managed_series
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_exclusions_insert AFTER INSERT ON catalog_assembly_exclusions
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_exclusions_update AFTER UPDATE ON catalog_assembly_exclusions
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_exclusions_delete AFTER DELETE ON catalog_assembly_exclusions
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_relation_overrides_insert AFTER INSERT ON catalog_assembly_relation_overrides
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_relation_overrides_update AFTER UPDATE ON catalog_assembly_relation_overrides
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_relation_overrides_delete AFTER DELETE ON catalog_assembly_relation_overrides
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_manual_insert AFTER INSERT ON catalog_assembly_manual
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_manual_update AFTER UPDATE ON catalog_assembly_manual
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
CREATE TRIGGER quote_display_catalog_assembly_manual_delete AFTER DELETE ON catalog_assembly_manual
BEGIN UPDATE quote_list_display_revision SET version = version + 1 WHERE singleton = 1; END;
--> statement-breakpoint
UPDATE application_schema_state SET version=81, updated_at=CURRENT_TIMESTAMP WHERE singleton=1;
