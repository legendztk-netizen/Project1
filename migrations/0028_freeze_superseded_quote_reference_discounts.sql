DROP TRIGGER `quote_reference_discounts_block_published_insert`;
--> statement-breakpoint
DROP TRIGGER `quote_reference_discounts_block_published_update`;
--> statement-breakpoint
DROP TRIGGER `quote_reference_discounts_block_published_delete`;
--> statement-breakpoint
CREATE TRIGGER `quote_reference_discounts_block_immutable_insert`
BEFORE INSERT ON `quote_reference_discounts`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = NEW.`release_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_QUOTE_REFERENCE_DISCOUNT');
END;
--> statement-breakpoint
CREATE TRIGGER `quote_reference_discounts_block_immutable_update`
BEFORE UPDATE ON `quote_reference_discounts`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` IN (OLD.`release_id`, NEW.`release_id`)
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_QUOTE_REFERENCE_DISCOUNT');
END;
--> statement-breakpoint
CREATE TRIGGER `quote_reference_discounts_block_immutable_delete`
BEFORE DELETE ON `quote_reference_discounts`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_QUOTE_REFERENCE_DISCOUNT');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 29, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
