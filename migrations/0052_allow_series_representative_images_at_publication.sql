-- Keep the transaction-level publication guard aligned with the effective
-- Catalog image rule: a product override wins, otherwise Hose and Hose End
-- variants inherit their reviewed Series representative image.
DROP TRIGGER `catalog_release_spec8_precondition`;
--> statement-breakpoint
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
         AND `image`.`assignment_kind` = 'override'
        LEFT JOIN `catalog_hose_variants` AS `hose`
          ON `hose`.`import_id` = `product`.`import_id`
         AND `hose`.`sku` = `product`.`sku`
        LEFT JOIN `catalog_hose_series` AS `hose_series`
          ON `hose_series`.`import_id` = `hose`.`import_id`
         AND `hose_series`.`series_code` = `hose`.`hose_series`
        LEFT JOIN `catalog_hose_ends` AS `hose_end`
          ON `hose_end`.`import_id` = `product`.`import_id`
         AND `hose_end`.`sku` = `product`.`sku`
        LEFT JOIN `catalog_hose_end_series` AS `hose_end_series`
          ON `hose_end_series`.`import_id` = `hose_end`.`import_id`
         AND `hose_end_series`.`series_code` = `hose_end`.`fitting_series`
        LEFT JOIN `catalog_media_versions` AS `media`
          ON `media`.`id` = COALESCE(
            `image`.`media_version_id`,
            `hose_series`.`representative_media_version_id`,
            `hose_end_series`.`representative_media_version_id`
          )
        WHERE `product`.`import_id` = `target_release`.`source_import_id`
          AND `product`.`catalog_publication_status` = 'Published'
          AND (
            `media`.`id` IS NULL
            OR (
              `media`.`approved_reference` IS NULL
              AND `media`.`storefront_object_key` IS NULL
            )
            OR (
              `media`.`approved_reference` IS NOT NULL
              AND `media`.`approved_reference` NOT LIKE 'hose-series:%'
              AND `media`.`approved_reference` NOT LIKE 'hose-end-shape:%'
            )
          )
      )
  ) THEN RAISE(ABORT, 'spec 8 catalog publication precondition failed') END;
END;
--> statement-breakpoint

UPDATE `application_schema_state`
SET `version` = 53, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
