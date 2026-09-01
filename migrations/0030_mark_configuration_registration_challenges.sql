ALTER TABLE `customer_otp_challenges`
ADD COLUMN `registration_configuration_requested` integer DEFAULT 0 NOT NULL
CHECK (`registration_configuration_requested` IN (0, 1));
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 31, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
