ALTER TABLE `customer_saved_configurations`
ADD COLUMN `command_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_saved_configuration_command_uq`
ON `customer_saved_configurations` (`profile_id`, `command_id`)
WHERE `command_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 38, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
