ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `line_kind` text NOT NULL DEFAULT 'standard'
CHECK (`line_kind` IN ('standard', 'length_based_hose'));
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `original_length_value` real
CHECK (`original_length_value` IS NULL OR `original_length_value` > 0);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `original_length_unit` text
CHECK (`original_length_unit` IS NULL OR `original_length_unit` = 'ft');
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `normalized_length_ft` real
CHECK (`normalized_length_ft` IS NULL OR `normalized_length_ft` > 0);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `piece_count` integer
CHECK (`piece_count` IS NULL OR `piece_count` BETWEEN 1 AND 9999);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `total_footage` real
CHECK (`total_footage` IS NULL OR `total_footage` > 0);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `cutting_labeling_fee_rate` real
CHECK (`cutting_labeling_fee_rate` IS NULL OR `cutting_labeling_fee_rate` >= 0);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `cutting_labeling_fee_amount` real
CHECK (`cutting_labeling_fee_amount` IS NULL OR `cutting_labeling_fee_amount` >= 0);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `cutting_labeling_fee_scope` text;
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `cutting_labeling_fee_version` integer
CHECK (`cutting_labeling_fee_version` IS NULL OR `cutting_labeling_fee_version` > 0);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `estimated_merchandise_amount` real
CHECK (`estimated_merchandise_amount` IS NULL OR `estimated_merchandise_amount` >= 0);
--> statement-breakpoint
ALTER TABLE `anonymous_quote_lines`
ADD COLUMN `current_estimate_amount` real
CHECK (`current_estimate_amount` IS NULL OR `current_estimate_amount` >= 0);
--> statement-breakpoint
CREATE TABLE `cutting_labeling_fee_rates` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`hose_series` text,
	`currency` text NOT NULL DEFAULT 'USD',
	`rate_per_piece` real NOT NULL DEFAULT 0,
	`version` integer NOT NULL DEFAULT 1,
	`updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `cutting_labeling_fee_rate_nonnegative` CHECK (`rate_per_piece` >= 0),
	CONSTRAINT `cutting_labeling_fee_version_positive` CHECK (`version` > 0),
	CONSTRAINT `cutting_labeling_fee_currency_usd` CHECK (`currency` = 'USD'),
	CONSTRAINT `cutting_labeling_fee_scope_shape` CHECK (
		(`scope_key` = 'global' AND `hose_series` IS NULL)
		OR (`scope_key` = 'series:' || `hose_series` AND `hose_series` IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cutting_labeling_fee_rates_hose_series_uq`
ON `cutting_labeling_fee_rates` (`hose_series`)
WHERE `hose_series` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `cutting_labeling_fee_rates`
  (`scope_key`, `hose_series`, `currency`, `rate_per_piece`, `version`)
VALUES ('global', NULL, 'USD', 0, 1);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 12, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
