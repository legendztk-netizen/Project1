-- Repeat the complete persisted-release validation in the publication
-- transaction. The application preview remains the human-readable report;
-- this trigger is the final fail-closed guard immediately before activation.

DROP TRIGGER `catalog_release_publication_precondition`;
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
      AND NOT EXISTS (
        SELECT 1 FROM `catalog_import_validation_results`
        WHERE `import_id` = `source_import`.`id` AND `severity` = 'error'
      )
      AND json_extract(`source_import`.`summary_json`, '$.skuCount') =
        (SELECT COUNT(*) FROM `catalog_skus` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.hoseSeriesCount') =
        (SELECT COUNT(*) FROM `catalog_hose_series` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.hoseVariantCount') =
        (SELECT COUNT(*) FROM `catalog_hose_variants` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.hoseEndCount') =
        (SELECT COUNT(*) FROM `catalog_hose_ends` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.ferruleCount') =
        (SELECT COUNT(*) FROM `catalog_ferrules` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.compatibilityCount') =
        (SELECT COUNT(*) FROM `catalog_compatibilities` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.adapterFamilyCount') =
        (SELECT COUNT(*) FROM `catalog_adapter_families` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.adapterCount') =
        (SELECT COUNT(*) FROM `catalog_adapters` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.quickCouplerCount') =
        (SELECT COUNT(*) FROM `catalog_quick_couplers` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.salesOfferCount') =
        (SELECT COUNT(*) FROM `catalog_sales_offers` WHERE `import_id` = `source_import`.`id`)
      AND json_extract(`source_import`.`summary_json`, '$.referencePriceCount') =
        (SELECT COUNT(*) FROM `catalog_sales_offers`
         WHERE `import_id` = `source_import`.`id` AND `reference_price_usd` IS NOT NULL)
      AND json_extract(`source_import`.`summary_json`, '$.costBasisPriceCount') =
        (SELECT COUNT(*) FROM `catalog_cost_bases`
         WHERE `import_id` = `source_import`.`id`
           AND (`factory_unit_price` IS NOT NULL OR `tier_price` IS NOT NULL))
      AND (SELECT COUNT(*) FROM `catalog_cost_bases`
           WHERE `import_id` = `source_import`.`id`) =
          (SELECT COUNT(*) FROM `catalog_sales_offers`
           WHERE `import_id` = `source_import`.`id`)
      AND (SELECT COUNT(*) FROM `catalog_skus`
           WHERE `import_id` = `source_import`.`id`) > 0
      AND NOT EXISTS (
        SELECT 1 FROM `catalog_skus`
        WHERE `import_id` = `source_import`.`id`
          AND (
            `catalog_publication_status` NOT IN ('Draft', 'Published', 'Archived')
            OR `rfq_eligibility` NOT IN ('Eligible', 'Manual Quote Only', 'Blocked')
            OR `technical_data_status` NOT IN ('Complete', 'Inherited', 'Pending')
            OR `supply_availability` NOT IN (
              'available_for_quote', 'temporarily_unavailable', 'discontinued'
            )
          )
      )
  ) THEN RAISE(ABORT, 'catalog publication precondition failed') END;
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 10, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
