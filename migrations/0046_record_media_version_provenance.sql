ALTER TABLE `catalog_media_versions` ADD `source_notes` text;
--> statement-breakpoint
ALTER TABLE `catalog_media_versions` ADD `license_notes` text;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 47, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
