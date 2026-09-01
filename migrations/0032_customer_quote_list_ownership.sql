ALTER TABLE `anonymous_quote_sessions`
ADD COLUMN `profile_id` text REFERENCES `customer_profiles`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `anonymous_quote_sessions`
ADD COLUMN `retired_at` text;
--> statement-breakpoint
ALTER TABLE `anonymous_quote_sessions`
ADD COLUMN `merged_into_session_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_sessions_profile_uq`
ON `anonymous_quote_sessions` (`profile_id`)
WHERE `profile_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `quote_sessions_profile_activity_idx`
ON `anonymous_quote_sessions` (`profile_id`, `last_activity_at`)
WHERE `profile_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `customer_quote_list_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`source_session_id` text NOT NULL,
	`destination_session_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`result_json` text NOT NULL CHECK (json_valid(`result_json`)),
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_quote_list_merges_source_uq`
ON `customer_quote_list_merges` (`source_session_id`);
--> statement-breakpoint
CREATE INDEX `customer_quote_list_merges_profile_created_idx`
ON `customer_quote_list_merges` (`profile_id`, `created_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 33, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
