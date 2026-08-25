CREATE TABLE `anonymous_quote_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `anonymous_quote_sessions_expires_at_idx`
ON `anonymous_quote_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `anonymous_quote_lines` (
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
	FOREIGN KEY (`session_id`) REFERENCES `anonymous_quote_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_release_id`) REFERENCES `catalog_releases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `anonymous_quote_line_quantity` CHECK (`quantity` BETWEEN 1 AND 9999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anonymous_quote_lines_session_identity_uq`
ON `anonymous_quote_lines` (`session_id`,`line_identity`);
--> statement-breakpoint
CREATE INDEX `anonymous_quote_lines_session_updated_idx`
ON `anonymous_quote_lines` (`session_id`,`updated_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 11, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
