ALTER TABLE `catalog_compatibilities` ADD `catalog_publication_status` text DEFAULT 'Draft' NOT NULL;--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 4, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
