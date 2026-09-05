CREATE TABLE `catalog_assembly_impact_analyses` (
  `release_id` text PRIMARY KEY NOT NULL,
  `baseline_release_id` text,
  `active_generation` integer NOT NULL,
  `shared_rule_fingerprint` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `affected_series_json` text NOT NULL CHECK (json_valid(`affected_series_json`)),
  `source_changes_json` text NOT NULL CHECK (json_valid(`source_changes_json`)),
  `status` text NOT NULL CHECK (`status` IN ('current', 'stale')),
  `calculated_at` text NOT NULL,
  `calculated_by` text NOT NULL,
  `last_calculation_id` text NOT NULL UNIQUE,
  FOREIGN KEY (`release_id`) REFERENCES `catalog_releases`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`baseline_release_id`) REFERENCES `catalog_releases`(`id`)
);
--> statement-breakpoint
CREATE INDEX `catalog_assembly_impact_status_idx`
ON `catalog_assembly_impact_analyses` (`status`, `release_id`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 48, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
