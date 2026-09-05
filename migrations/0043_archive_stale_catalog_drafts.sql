-- A superseded release is the catalog's immutable archive state. Permit a
-- draft to enter that state without changing its identity or content.
DROP TRIGGER `catalogreleases_lock_draft_metadata`;
--> statement-breakpoint
CREATE TRIGGER `catalogreleases_lock_draft_metadata`
BEFORE UPDATE ON `catalog_releases`
WHEN OLD.`status` = 'draft'
  AND NOT (
    NEW.`id` IS OLD.`id`
    AND NEW.`release_number` IS OLD.`release_number`
    AND NEW.`source_import_id` IS OLD.`source_import_id`
    AND NEW.`created_at` IS OLD.`created_at`
    AND (
      (
        NEW.`status` = 'draft'
        AND NEW.`published_at` IS OLD.`published_at`
        AND NEW.`version` IN (OLD.`version`, OLD.`version` + 1)
      )
      OR (
        NEW.`status` = 'published'
        AND OLD.`published_at` IS NULL
        AND NEW.`published_at` IS NOT NULL
        AND NEW.`version` = OLD.`version` + 1
      )
      OR (
        NEW.`status` = 'superseded'
        AND NEW.`published_at` IS OLD.`published_at`
        AND NEW.`version` IS OLD.`version`
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'draft catalog release metadata is immutable');
END;
--> statement-breakpoint
UPDATE `catalog_releases` AS `draft`
SET `status` = 'superseded'
WHERE `draft`.`status` = 'draft'
  AND EXISTS (
    SELECT 1
    FROM `catalog_active_release` AS `active_pointer`
    INNER JOIN `catalog_releases` AS `active_release`
      ON `active_release`.`id` = `active_pointer`.`release_id`
    WHERE `active_pointer`.`singleton` = 1
      AND `draft`.`created_at` <= `active_release`.`created_at`
  );
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 44, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
