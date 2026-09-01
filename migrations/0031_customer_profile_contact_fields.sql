ALTER TABLE `customer_profiles` ADD COLUMN `full_name` text;
--> statement-breakpoint
ALTER TABLE `customer_profiles` ADD COLUMN `phone_number` text;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 32, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
