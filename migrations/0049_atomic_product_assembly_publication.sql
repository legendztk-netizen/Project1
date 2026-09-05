ALTER TABLE `catalog_release_publications`
ADD `expected_assembly_input_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `catalog_release_publications`
ADD `expected_assembly_generation_id` text;
--> statement-breakpoint
ALTER TABLE `catalog_release_publications`
ADD `expected_derived_series_count` integer;
--> statement-breakpoint
ALTER TABLE `catalog_release_publications`
ADD `expected_derived_combination_count` integer;
--> statement-breakpoint
ALTER TABLE `catalog_release_publications`
ADD `summary_json` text CHECK (`summary_json` IS NULL OR json_valid(`summary_json`));
--> statement-breakpoint

-- Image assignments are release content. Advancing the draft revision makes a
-- preview stale when an image is added, replaced, or removed after review.
CREATE TRIGGER `catalogproductmainimages_draft_insert_revision`
AFTER INSERT ON `catalog_product_main_images`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogproductmainimages_draft_update_revision`
AFTER UPDATE ON `catalog_product_main_images`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` IN (OLD.`import_id`, NEW.`import_id`)
    AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `catalogproductmainimages_draft_delete_revision`
AFTER DELETE ON `catalog_product_main_images`
BEGIN
  UPDATE `catalog_releases`
  SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

-- The application supplies the short assembly snapshot captured by the human
-- preview. This trigger rechecks it inside the same transaction that activates
-- products, prices, images, relationships, registries, and derived data.
CREATE TRIGGER `catalog_release_spec8_precondition`
BEFORE INSERT ON `catalog_release_publications`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `catalog_releases` AS `target_release`
    INNER JOIN `catalog_assembly_impact_analyses` AS `impact`
      ON `impact`.`release_id` = `target_release`.`id`
    WHERE `target_release`.`id` = NEW.`release_id`
      AND `target_release`.`status` = 'draft'
      AND `impact`.`status` = 'current'
      AND `impact`.`input_fingerprint` = NEW.`expected_assembly_input_fingerprint`
      AND NEW.`expected_derived_series_count` = (
        SELECT COUNT(*) FROM `catalog_derived_assembly_series`
        WHERE `release_id` = `target_release`.`id`
      )
      AND NEW.`expected_derived_combination_count` = (
        SELECT COUNT(*) FROM `catalog_derived_assembly_combinations`
        WHERE `release_id` = `target_release`.`id`
      )
      AND NEW.`expected_assembly_generation_id` IS (
        SELECT group_concat(`generation_id`, ',') FROM (
          SELECT DISTINCT `generation_id`
          FROM `catalog_derived_assembly_series`
          WHERE `release_id` = `target_release`.`id`
          ORDER BY `generation_id`
        )
      )
      AND (
        SELECT COUNT(DISTINCT `hose_series`)
        FROM `catalog_skus`
        WHERE `import_id` = `target_release`.`source_import_id`
          AND `product_type` = 'hose'
          AND `hose_series` IS NOT NULL
      ) = (
        SELECT COUNT(*) FROM `catalog_derived_assembly_series`
        WHERE `release_id` = `target_release`.`id`
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_derived_assembly_series` AS `series`
        WHERE `series`.`release_id` = `target_release`.`id`
          AND (
            `series`.`source_import_id` <> `target_release`.`source_import_id`
            OR `series`.`combination_count` <> (
              SELECT COUNT(*)
              FROM `catalog_derived_assembly_combinations` AS `combination`
              WHERE `combination`.`release_id` = `series`.`release_id`
                AND `combination`.`hose_series` = `series`.`hose_series`
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_skus` AS `product`
        WHERE `product`.`import_id` = `target_release`.`source_import_id`
          AND `product`.`catalog_publication_status` = 'Published'
          AND NOT EXISTS (
            SELECT 1 FROM `catalog_sales_offers` AS `offer`
            WHERE `offer`.`import_id` = `product`.`import_id`
              AND `offer`.`base_sku` = `product`.`sku`
              AND `offer`.`catalog_publication_status` = 'Published'
              AND `offer`.`currency` = 'USD'
              AND `offer`.`reference_price_usd` IS NOT NULL
              AND `offer`.`reference_price_usd` >= 0
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_skus` AS `product`
        LEFT JOIN `catalog_product_main_images` AS `image`
          ON `image`.`import_id` = `product`.`import_id`
         AND `image`.`sku` = `product`.`sku`
        LEFT JOIN `catalog_media_versions` AS `media`
          ON `media`.`id` = `image`.`media_version_id`
        WHERE `product`.`import_id` = `target_release`.`source_import_id`
          AND `product`.`catalog_publication_status` = 'Published'
          AND `media`.`id` IS NULL
      )
  ) THEN RAISE(ABORT, 'spec 8 catalog publication precondition failed') END;
END;
--> statement-breakpoint

UPDATE `application_schema_state`
SET `version` = 50, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
