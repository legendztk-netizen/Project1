ALTER TABLE `customer_otp_challenges`
ADD COLUMN `delivery_status` text DEFAULT 'delivered' NOT NULL
CHECK (`delivery_status` IN ('pending', 'delivered'));
--> statement-breakpoint
ALTER TABLE `customer_sessions` DROP COLUMN `last_seen_at`;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 22, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
