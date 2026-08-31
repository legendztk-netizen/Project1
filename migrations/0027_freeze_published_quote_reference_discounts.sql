CREATE TRIGGER `quote_reference_discounts_block_published_insert`
BEFORE INSERT ON `quote_reference_discounts`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = NEW.`release_id` AND `status` = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'PUBLISHED_QUOTE_REFERENCE_DISCOUNT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `quote_reference_discounts_block_published_update`
BEFORE UPDATE ON `quote_reference_discounts`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'PUBLISHED_QUOTE_REFERENCE_DISCOUNT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `quote_reference_discounts_block_published_delete`
BEFORE DELETE ON `quote_reference_discounts`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` = 'published'
)
BEGIN
  SELECT RAISE(ABORT, 'PUBLISHED_QUOTE_REFERENCE_DISCOUNT_IMMUTABLE');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 28, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
