DROP TRIGGER IF EXISTS `anonymous_quote_lines_validate_shape_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `anonymous_quote_lines_validate_shape_update`;
--> statement-breakpoint
CREATE TABLE `anonymous_quote_lines_next` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`line_identity` text NOT NULL,
	`sku` text NOT NULL,
	`catalog_release_id` text NOT NULL,
	`display_name` text NOT NULL,
	`category` text NOT NULL,
	`quantity` integer NOT NULL,
	`sales_unit` text NOT NULL,
	`currency` text NOT NULL,
	`reference_unit_price` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`line_kind` text NOT NULL DEFAULT 'standard'
		CHECK (`line_kind` IN ('standard', 'length_based_hose', 'configured_assembly')),
	`original_length_value` real CHECK (`original_length_value` IS NULL OR `original_length_value` > 0),
	`original_length_unit` text CHECK (`original_length_unit` IS NULL OR `original_length_unit` = 'ft'),
	`normalized_length_ft` real CHECK (`normalized_length_ft` IS NULL OR `normalized_length_ft` > 0),
	`piece_count` integer CHECK (`piece_count` IS NULL OR `piece_count` BETWEEN 1 AND 9999),
	`total_footage` real CHECK (`total_footage` IS NULL OR `total_footage` > 0),
	`cutting_labeling_fee_rate` real CHECK (`cutting_labeling_fee_rate` IS NULL OR `cutting_labeling_fee_rate` >= 0),
	`cutting_labeling_fee_amount` real CHECK (`cutting_labeling_fee_amount` IS NULL OR `cutting_labeling_fee_amount` >= 0),
	`cutting_labeling_fee_scope` text,
	`cutting_labeling_fee_version` integer CHECK (`cutting_labeling_fee_version` IS NULL OR `cutting_labeling_fee_version` > 0),
	`estimated_merchandise_amount` real CHECK (`estimated_merchandise_amount` IS NULL OR `estimated_merchandise_amount` >= 0),
	`current_estimate_amount` real CHECK (`current_estimate_amount` IS NULL OR `current_estimate_amount` >= 0),
	`configured_snapshot_json` text,
	`configured_estimate_inputs_json` text,
	`configured_unit_estimate_amount` real CHECK (`configured_unit_estimate_amount` IS NULL OR `configured_unit_estimate_amount` >= 0),
	FOREIGN KEY (`session_id`) REFERENCES `anonymous_quote_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_release_id`) REFERENCES `catalog_releases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `anonymous_quote_line_quantity` CHECK (`quantity` BETWEEN 1 AND 9999)
);
--> statement-breakpoint
INSERT INTO `anonymous_quote_lines_next` (
  `id`, `session_id`, `line_identity`, `sku`, `catalog_release_id`,
  `display_name`, `category`, `quantity`, `sales_unit`, `currency`,
  `reference_unit_price`, `created_at`, `updated_at`, `line_kind`,
  `original_length_value`, `original_length_unit`, `normalized_length_ft`,
  `piece_count`, `total_footage`, `cutting_labeling_fee_rate`,
  `cutting_labeling_fee_amount`, `cutting_labeling_fee_scope`,
  `cutting_labeling_fee_version`, `estimated_merchandise_amount`,
  `current_estimate_amount`
)
SELECT
  `id`, `session_id`, `line_identity`, `sku`, `catalog_release_id`,
  `display_name`, `category`, `quantity`, `sales_unit`, `currency`,
  `reference_unit_price`, `created_at`, `updated_at`, `line_kind`,
  `original_length_value`, `original_length_unit`, `normalized_length_ft`,
  `piece_count`, `total_footage`, `cutting_labeling_fee_rate`,
  `cutting_labeling_fee_amount`, `cutting_labeling_fee_scope`,
  `cutting_labeling_fee_version`, `estimated_merchandise_amount`,
  `current_estimate_amount`
FROM `anonymous_quote_lines`;
--> statement-breakpoint
DROP TABLE `anonymous_quote_lines`;
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines_next` RENAME TO `anonymous_quote_lines`;
--> statement-breakpoint
CREATE UNIQUE INDEX `anonymous_quote_lines_session_identity_uq`
ON `anonymous_quote_lines` (`session_id`,`line_identity`);
--> statement-breakpoint
CREATE INDEX `anonymous_quote_lines_session_updated_idx`
ON `anonymous_quote_lines` (`session_id`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `anonymous_quote_lines_validate_shape_insert`
BEFORE INSERT ON `anonymous_quote_lines`
WHEN (
  NEW.`line_kind` = 'standard'
  AND (
    NEW.`original_length_value` IS NOT NULL OR NEW.`original_length_unit` IS NOT NULL
    OR NEW.`normalized_length_ft` IS NOT NULL OR NEW.`piece_count` IS NOT NULL
    OR NEW.`total_footage` IS NOT NULL OR NEW.`cutting_labeling_fee_rate` IS NOT NULL
    OR NEW.`cutting_labeling_fee_amount` IS NOT NULL OR NEW.`cutting_labeling_fee_scope` IS NOT NULL
    OR NEW.`cutting_labeling_fee_version` IS NOT NULL OR NEW.`estimated_merchandise_amount` IS NOT NULL
    OR NEW.`current_estimate_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NOT NULL
    OR NEW.`configured_estimate_inputs_json` IS NOT NULL OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'length_based_hose'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`original_length_value` IS NULL
    OR NEW.`original_length_unit` IS NULL OR NEW.`normalized_length_ft` IS NULL
    OR NEW.`piece_count` IS NULL OR NEW.`quantity` <> NEW.`piece_count`
    OR NEW.`total_footage` IS NULL OR NEW.`cutting_labeling_fee_rate` IS NULL
    OR NEW.`cutting_labeling_fee_amount` IS NULL OR NEW.`cutting_labeling_fee_scope` IS NULL
    OR NEW.`cutting_labeling_fee_version` IS NULL
    OR (NEW.`estimated_merchandise_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL)
    OR NEW.`configured_snapshot_json` IS NOT NULL OR NEW.`configured_estimate_inputs_json` IS NOT NULL
    OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'configured_assembly'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`sales_unit` <> 'each' OR NEW.`currency` <> 'USD'
    OR NEW.`reference_unit_price` IS NOT NULL OR NEW.`original_length_value` IS NOT NULL
    OR NEW.`original_length_unit` IS NOT NULL OR NEW.`normalized_length_ft` IS NOT NULL
    OR NEW.`piece_count` IS NOT NULL OR NEW.`total_footage` IS NOT NULL
    OR NEW.`cutting_labeling_fee_rate` IS NOT NULL OR NEW.`cutting_labeling_fee_amount` IS NOT NULL
    OR NEW.`cutting_labeling_fee_scope` IS NOT NULL OR NEW.`cutting_labeling_fee_version` IS NOT NULL
    OR NEW.`estimated_merchandise_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NULL
    OR NOT json_valid(NEW.`configured_snapshot_json`) OR NEW.`configured_estimate_inputs_json` IS NULL
    OR NOT json_valid(NEW.`configured_estimate_inputs_json`)
    OR (NEW.`configured_unit_estimate_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid anonymous quote line shape');
END;
--> statement-breakpoint
CREATE TRIGGER `anonymous_quote_lines_validate_shape_update`
BEFORE UPDATE ON `anonymous_quote_lines`
WHEN (
  NEW.`line_kind` = 'standard'
  AND (
    NEW.`original_length_value` IS NOT NULL OR NEW.`original_length_unit` IS NOT NULL
    OR NEW.`normalized_length_ft` IS NOT NULL OR NEW.`piece_count` IS NOT NULL
    OR NEW.`total_footage` IS NOT NULL OR NEW.`cutting_labeling_fee_rate` IS NOT NULL
    OR NEW.`cutting_labeling_fee_amount` IS NOT NULL OR NEW.`cutting_labeling_fee_scope` IS NOT NULL
    OR NEW.`cutting_labeling_fee_version` IS NOT NULL OR NEW.`estimated_merchandise_amount` IS NOT NULL
    OR NEW.`current_estimate_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NOT NULL
    OR NEW.`configured_estimate_inputs_json` IS NOT NULL OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'length_based_hose'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`original_length_value` IS NULL
    OR NEW.`original_length_unit` IS NULL OR NEW.`normalized_length_ft` IS NULL
    OR NEW.`piece_count` IS NULL OR NEW.`quantity` <> NEW.`piece_count`
    OR NEW.`total_footage` IS NULL OR NEW.`cutting_labeling_fee_rate` IS NULL
    OR NEW.`cutting_labeling_fee_amount` IS NULL OR NEW.`cutting_labeling_fee_scope` IS NULL
    OR NEW.`cutting_labeling_fee_version` IS NULL
    OR (NEW.`estimated_merchandise_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL)
    OR NEW.`configured_snapshot_json` IS NOT NULL OR NEW.`configured_estimate_inputs_json` IS NOT NULL
    OR NEW.`configured_unit_estimate_amount` IS NOT NULL
  )
) OR (
  NEW.`line_kind` = 'configured_assembly'
  AND (
    NEW.`category` <> 'hydraulic-hose' OR NEW.`sales_unit` <> 'each' OR NEW.`currency` <> 'USD'
    OR NEW.`reference_unit_price` IS NOT NULL OR NEW.`original_length_value` IS NOT NULL
    OR NEW.`original_length_unit` IS NOT NULL OR NEW.`normalized_length_ft` IS NOT NULL
    OR NEW.`piece_count` IS NOT NULL OR NEW.`total_footage` IS NOT NULL
    OR NEW.`cutting_labeling_fee_rate` IS NOT NULL OR NEW.`cutting_labeling_fee_amount` IS NOT NULL
    OR NEW.`cutting_labeling_fee_scope` IS NOT NULL OR NEW.`cutting_labeling_fee_version` IS NOT NULL
    OR NEW.`estimated_merchandise_amount` IS NOT NULL OR NEW.`configured_snapshot_json` IS NULL
    OR NOT json_valid(NEW.`configured_snapshot_json`) OR NEW.`configured_estimate_inputs_json` IS NULL
    OR NOT json_valid(NEW.`configured_estimate_inputs_json`)
    OR (NEW.`configured_unit_estimate_amount` IS NULL) <> (NEW.`current_estimate_amount` IS NULL)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid anonymous quote line shape');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 17, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
