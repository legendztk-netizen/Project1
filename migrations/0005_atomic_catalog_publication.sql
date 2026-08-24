UPDATE `catalog_releases`
SET `status` = 'superseded'
WHERE `status` = 'published'
  AND `id` <> (
    SELECT `id`
    FROM `catalog_releases`
    WHERE `status` = 'published'
    ORDER BY `published_at` DESC, `created_at` DESC, `id` DESC
    LIMIT 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_releases_one_published_uq`
ON `catalog_releases` (`status`)
WHERE `status` = 'published';
--> statement-breakpoint
CREATE TABLE `catalog_active_release` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`release_id` text,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `catalog_releases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `catalog_active_release_singleton` CHECK (`singleton` = 1)
);
--> statement-breakpoint
INSERT INTO `catalog_active_release` (`singleton`, `release_id`, `version`, `updated_at`)
VALUES (
	1,
	(SELECT `id` FROM `catalog_releases` WHERE `status` = 'published' LIMIT 1),
	CASE WHEN EXISTS (SELECT 1 FROM `catalog_releases` WHERE `status` = 'published') THEN 1 ELSE 0 END,
	CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `catalog_release_publications` (
	`release_id` text PRIMARY KEY NOT NULL,
	`previous_release_id` text,
	`expected_active_version` integer NOT NULL,
	`expected_draft_version` integer NOT NULL,
	`published_by` text NOT NULL,
	`request_correlation_id` text NOT NULL,
	`published_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `catalog_releases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_release_id`) REFERENCES `catalog_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_release_publications_request_uq`
ON `catalog_release_publications` (`request_correlation_id`);
--> statement-breakpoint
CREATE TRIGGER `catalog_release_publication_precondition`
BEFORE INSERT ON `catalog_release_publications`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1
		FROM `catalog_active_release`
		INNER JOIN `catalog_releases` AS `target_release`
			ON `target_release`.`id` = NEW.`release_id`
		INNER JOIN `catalog_imports` AS `source_import`
			ON `source_import`.`id` = `target_release`.`source_import_id`
		WHERE `catalog_active_release`.`singleton` = 1
			AND `catalog_active_release`.`version` = NEW.`expected_active_version`
			AND `catalog_active_release`.`release_id` IS NEW.`previous_release_id`
			AND `target_release`.`status` = 'draft'
			AND `target_release`.`version` = NEW.`expected_draft_version`
			AND `source_import`.`kind` = 'workbook'
			AND `source_import`.`status` = 'completed'
			AND `source_import`.`error_count` = 0
	) THEN RAISE(ABORT, 'catalog publication precondition failed') END;
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 6, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
