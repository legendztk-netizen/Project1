ALTER TABLE `customer_otp_challenges`
ADD COLUMN `quote_session_id_at_request` text;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 34, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
