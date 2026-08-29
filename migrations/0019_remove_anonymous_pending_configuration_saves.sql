DROP TABLE IF EXISTS `pending_configuration_email_effects`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pending_configuration_save_limits`;
--> statement-breakpoint
DROP TABLE IF EXISTS `pending_configuration_drafts`;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 20, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
