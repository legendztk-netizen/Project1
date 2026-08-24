-- Publication revalidation uses the draft release version as a compare-and-swap
-- token. Keep its identity and source snapshot fixed while allowing version
-- increments and the one controlled draft-to-published transition.

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
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'draft catalog release metadata is immutable');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 9, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
