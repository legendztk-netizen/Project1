CREATE TABLE `catalog_derived_assembly_series` (
  `release_id` text NOT NULL,
  `source_import_id` text NOT NULL,
  `hose_series` text NOT NULL,
  `generation_id` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `combination_count` integer NOT NULL CHECK (`combination_count` >= 0),
  `generated_at` text NOT NULL,
  `generated_by` text NOT NULL,
  PRIMARY KEY (`release_id`, `hose_series`),
  FOREIGN KEY (`release_id`) REFERENCES `catalog_releases`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_import_id`) REFERENCES `catalog_imports`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `catalog_derived_assembly_series_generation_idx`
ON `catalog_derived_assembly_series` (`release_id`, `generation_id`);
--> statement-breakpoint
CREATE TABLE `catalog_derived_assembly_combinations` (
  `id` text PRIMARY KEY NOT NULL,
  `release_id` text NOT NULL,
  `source_import_id` text NOT NULL,
  `hose_series` text NOT NULL,
  `hose_sku` text NOT NULL,
  `end_a_compatibility_id` text NOT NULL,
  `end_a_hose_end_sku` text NOT NULL,
  `end_a_ferrule_sku` text NOT NULL,
  `end_b_compatibility_id` text NOT NULL,
  `end_b_hose_end_sku` text NOT NULL,
  `end_b_ferrule_sku` text NOT NULL,
  `end_a_relationship_fingerprint` text NOT NULL,
  `end_b_relationship_fingerprint` text NOT NULL,
  `combination_fingerprint` text NOT NULL,
  `generated_at` text NOT NULL,
  FOREIGN KEY (`release_id`, `hose_series`)
    REFERENCES `catalog_derived_assembly_series`(`release_id`, `hose_series`)
    ON DELETE CASCADE,
  UNIQUE (
    `release_id`, `hose_sku`, `end_a_compatibility_id`,
    `end_b_compatibility_id`
  )
);
--> statement-breakpoint
CREATE INDEX `catalog_derived_assembly_combinations_series_idx`
ON `catalog_derived_assembly_combinations` (`release_id`, `hose_series`);
--> statement-breakpoint
CREATE TABLE `catalog_assembly_regenerations` (
  `id` text PRIMARY KEY NOT NULL,
  `release_id` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `affected_series_json` text NOT NULL CHECK (json_valid(`affected_series_json`)),
  `status` text NOT NULL CHECK (`status` IN ('succeeded', 'failed', 'already_current')),
  `addition_count` integer NOT NULL DEFAULT 0 CHECK (`addition_count` >= 0),
  `change_count` integer NOT NULL DEFAULT 0 CHECK (`change_count` >= 0),
  `removal_count` integer NOT NULL DEFAULT 0 CHECK (`removal_count` >= 0),
  `combination_count` integer NOT NULL DEFAULT 0 CHECK (`combination_count` >= 0),
  `actor_id` text NOT NULL,
  `occurred_at` text NOT NULL,
  `error_json` text CHECK (`error_json` IS NULL OR json_valid(`error_json`)),
  FOREIGN KEY (`release_id`) REFERENCES `catalog_releases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `catalog_assembly_regenerations_release_idx`
ON `catalog_assembly_regenerations` (`release_id`, `occurred_at` DESC);
--> statement-breakpoint
CREATE TRIGGER `catalogderivedassemblyseries_draft_insert`
BEFORE INSERT ON `catalog_derived_assembly_series`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = NEW.`release_id`
    AND `source_import_id` = NEW.`source_import_id`
    AND `status` = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'derived Assembly Series must belong to one draft release');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogderivedassemblyseries_immutable_update`
BEFORE UPDATE ON `catalog_derived_assembly_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published derived Assembly Series are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogderivedassemblyseries_immutable_delete`
BEFORE DELETE ON `catalog_derived_assembly_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published derived Assembly Series are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogderivedassemblycombinations_validate_insert`
BEFORE INSERT ON `catalog_derived_assembly_combinations`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `catalog_releases` AS `release`
    INNER JOIN `catalog_skus` AS `hose`
      ON `hose`.`import_id` = `release`.`source_import_id`
     AND `hose`.`sku` = NEW.`hose_sku`
    INNER JOIN `catalog_compatibilities` AS `end_a`
      ON `end_a`.`import_id` = `release`.`source_import_id`
     AND `end_a`.`compatibility_id` = NEW.`end_a_compatibility_id`
     AND `end_a`.`hose_sku` = NEW.`hose_sku`
     AND `end_a`.`hose_end_sku` = NEW.`end_a_hose_end_sku`
     AND `end_a`.`ferrule_sku` = NEW.`end_a_ferrule_sku`
    INNER JOIN `catalog_compatibilities` AS `end_b`
      ON `end_b`.`import_id` = `release`.`source_import_id`
     AND `end_b`.`compatibility_id` = NEW.`end_b_compatibility_id`
     AND `end_b`.`hose_sku` = NEW.`hose_sku`
     AND `end_b`.`hose_end_sku` = NEW.`end_b_hose_end_sku`
     AND `end_b`.`ferrule_sku` = NEW.`end_b_ferrule_sku`
    WHERE `release`.`id` = NEW.`release_id`
      AND `release`.`status` = 'draft'
      AND `release`.`source_import_id` = NEW.`source_import_id`
      AND `hose`.`product_type` = 'hose'
      AND `hose`.`hose_series` = NEW.`hose_series`
      AND `hose`.`catalog_publication_status` = 'Published'
      AND `hose`.`rfq_eligibility` = 'Eligible'
      AND `hose`.`supply_availability` = 'available_for_quote'
      AND `end_a`.`catalog_publication_status` = 'Published'
      AND `end_a`.`rfq_eligibility` = 'Eligible'
      AND `end_b`.`catalog_publication_status` = 'Published'
      AND `end_b`.`rfq_eligibility` = 'Eligible'
      AND EXISTS (
        SELECT 1 FROM `catalog_hose_variants` AS `hose_detail`
        WHERE `hose_detail`.`import_id` = NEW.`source_import_id`
          AND `hose_detail`.`sku` = NEW.`hose_sku`
      )
      AND EXISTS (
        SELECT 1
        FROM `catalog_skus` AS `component`
        INNER JOIN `catalog_hose_ends` AS `detail`
          ON `detail`.`import_id` = `component`.`import_id`
         AND `detail`.`sku` = `component`.`sku`
        WHERE `component`.`import_id` = NEW.`source_import_id`
          AND `component`.`sku` = NEW.`end_a_hose_end_sku`
          AND `component`.`product_type` = 'hose_end'
          AND `component`.`catalog_publication_status` = 'Published'
          AND `component`.`rfq_eligibility` = 'Eligible'
          AND `component`.`supply_availability` = 'available_for_quote'
      )
      AND EXISTS (
        SELECT 1
        FROM `catalog_skus` AS `component`
        INNER JOIN `catalog_hose_ends` AS `detail`
          ON `detail`.`import_id` = `component`.`import_id`
         AND `detail`.`sku` = `component`.`sku`
        WHERE `component`.`import_id` = NEW.`source_import_id`
          AND `component`.`sku` = NEW.`end_b_hose_end_sku`
          AND `component`.`product_type` = 'hose_end'
          AND `component`.`catalog_publication_status` = 'Published'
          AND `component`.`rfq_eligibility` = 'Eligible'
          AND `component`.`supply_availability` = 'available_for_quote'
      )
      AND EXISTS (
        SELECT 1
        FROM `catalog_skus` AS `component`
        INNER JOIN `catalog_ferrules` AS `detail`
          ON `detail`.`import_id` = `component`.`import_id`
         AND `detail`.`sku` = `component`.`sku`
        WHERE `component`.`import_id` = NEW.`source_import_id`
          AND `component`.`sku` = NEW.`end_a_ferrule_sku`
          AND `component`.`product_type` = 'ferrule'
          AND `component`.`catalog_publication_status` = 'Published'
          AND `component`.`rfq_eligibility` = 'Eligible'
          AND `component`.`supply_availability` = 'available_for_quote'
      )
      AND EXISTS (
        SELECT 1
        FROM `catalog_skus` AS `component`
        INNER JOIN `catalog_ferrules` AS `detail`
          ON `detail`.`import_id` = `component`.`import_id`
         AND `detail`.`sku` = `component`.`sku`
        WHERE `component`.`import_id` = NEW.`source_import_id`
          AND `component`.`sku` = NEW.`end_b_ferrule_sku`
          AND `component`.`product_type` = 'ferrule'
          AND `component`.`catalog_publication_status` = 'Published'
          AND `component`.`rfq_eligibility` = 'Eligible'
          AND `component`.`supply_availability` = 'available_for_quote'
      )
      AND NEW.`end_a_relationship_fingerprint` = json_object(
        'hoseSku', `end_a`.`hose_sku`,
        'hoseEndSku', `end_a`.`hose_end_sku`,
        'ferruleSku', `end_a`.`ferrule_sku`,
        'catalogPublicationStatus', `end_a`.`catalog_publication_status`,
        'rfqEligibility', `end_a`.`rfq_eligibility`,
        'technicalDataStatus', `end_a`.`technical_data_status`,
        'assemblyMethod', `end_a`.`assembly_method`,
        'skiveRequirement', `end_a`.`skive_requirement`,
        'outerSkiveLengthMm', `end_a`.`outer_skive_length_mm`,
        'innerSkiveLengthMm', `end_a`.`inner_skive_length_mm`,
        'insertionDepthMm', `end_a`.`insertion_depth_mm`,
        'crimpProgram', `end_a`.`crimp_program`,
        'finalCrimpDiameterMm', `end_a`.`final_crimp_diameter_mm`,
        'toleranceMm', `end_a`.`tolerance_mm`,
        'measurementLocation', `end_a`.`measurement_location`,
        'assemblyWorkingBar', `end_a`.`assembly_working_bar`,
        'proofPressureBar', `end_a`.`proof_pressure_bar`,
        'proofHoldSeconds', `end_a`.`proof_hold_seconds`,
        'qualificationId', `end_a`.`qualification_id`,
        'qualificationStatus', `end_a`.`qualification_status`
      )
      AND NEW.`end_b_relationship_fingerprint` = json_object(
        'hoseSku', `end_b`.`hose_sku`,
        'hoseEndSku', `end_b`.`hose_end_sku`,
        'ferruleSku', `end_b`.`ferrule_sku`,
        'catalogPublicationStatus', `end_b`.`catalog_publication_status`,
        'rfqEligibility', `end_b`.`rfq_eligibility`,
        'technicalDataStatus', `end_b`.`technical_data_status`,
        'assemblyMethod', `end_b`.`assembly_method`,
        'skiveRequirement', `end_b`.`skive_requirement`,
        'outerSkiveLengthMm', `end_b`.`outer_skive_length_mm`,
        'innerSkiveLengthMm', `end_b`.`inner_skive_length_mm`,
        'insertionDepthMm', `end_b`.`insertion_depth_mm`,
        'crimpProgram', `end_b`.`crimp_program`,
        'finalCrimpDiameterMm', `end_b`.`final_crimp_diameter_mm`,
        'toleranceMm', `end_b`.`tolerance_mm`,
        'measurementLocation', `end_b`.`measurement_location`,
        'assemblyWorkingBar', `end_b`.`assembly_working_bar`,
        'proofPressureBar', `end_b`.`proof_pressure_bar`,
        'proofHoldSeconds', `end_b`.`proof_hold_seconds`,
        'qualificationId', `end_b`.`qualification_id`,
        'qualificationStatus', `end_b`.`qualification_status`
      )
      AND NEW.`combination_fingerprint` = json_array(
        json_array(
          NEW.`hose_sku`, NEW.`end_a_compatibility_id`,
          NEW.`end_b_compatibility_id`
        ) || '',
        NEW.`end_a_relationship_fingerprint` || '',
        NEW.`end_b_relationship_fingerprint` || ''
      )
  ) THEN RAISE(ABORT, 'derived Assembly Combination has invalid or cross-version provenance') END;
END;
--> statement-breakpoint
CREATE TRIGGER `catalogderivedassemblycombinations_immutable_update`
BEFORE UPDATE ON `catalog_derived_assembly_combinations`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published derived Assembly Combinations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogderivedassemblycombinations_immutable_delete`
BEFORE DELETE ON `catalog_derived_assembly_combinations`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published derived Assembly Combinations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogassemblyregenerations_consistency`
BEFORE INSERT ON `catalog_assembly_regenerations`
WHEN NEW.`status` = 'succeeded'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `catalog_releases` AS `release`
    INNER JOIN `catalog_active_release` AS `active` ON `active`.`singleton` = 1
    INNER JOIN `catalog_assembly_impact_analyses` AS `impact`
      ON `impact`.`release_id` = `release`.`id`
    WHERE `release`.`id` = NEW.`release_id`
      AND `release`.`status` = 'draft'
      AND `impact`.`status` = 'stale'
      AND `impact`.`input_fingerprint` = NEW.`input_fingerprint`
      AND `impact`.`active_generation` = `active`.`version`
      AND NEW.`combination_count` = (
        SELECT COUNT(*)
        FROM `catalog_derived_assembly_combinations` AS `combination`
        INNER JOIN `catalog_derived_assembly_series` AS `series`
          ON `series`.`release_id` = `combination`.`release_id`
         AND `series`.`hose_series` = `combination`.`hose_series`
        WHERE `series`.`release_id` = NEW.`release_id`
          AND `series`.`generation_id` = NEW.`id`
          AND `series`.`hose_series` IN (
            SELECT value FROM json_each(NEW.`affected_series_json`)
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (
          SELECT DISTINCT `hose_series`
          FROM `catalog_skus`
          WHERE `import_id` = `release`.`source_import_id`
            AND `product_type` = 'hose'
            AND `hose_series` IS NOT NULL
        ) AS `expected_series`
        LEFT JOIN `catalog_derived_assembly_series` AS `generated_series`
          ON `generated_series`.`release_id` = `release`.`id`
         AND `generated_series`.`hose_series` = `expected_series`.`hose_series`
        WHERE `generated_series`.`hose_series` IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_derived_assembly_series` AS `generated_series`
        WHERE `generated_series`.`release_id` = `release`.`id`
          AND (
            `generated_series`.`source_import_id` <> `release`.`source_import_id`
            OR NOT EXISTS (
              SELECT 1 FROM `catalog_skus` AS `hose`
              WHERE `hose`.`import_id` = `release`.`source_import_id`
                AND `hose`.`product_type` = 'hose'
                AND `hose`.`hose_series` = `generated_series`.`hose_series`
            )
            OR `generated_series`.`combination_count` <> (
              SELECT COUNT(*)
              FROM `catalog_derived_assembly_combinations` AS `combination`
              WHERE `combination`.`release_id` = `release`.`id`
                AND `combination`.`hose_series` = `generated_series`.`hose_series`
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_derived_assembly_series` AS `generated_series`
        WHERE `generated_series`.`release_id` = `release`.`id`
          AND `generated_series`.`hose_series` IN (
            SELECT value FROM json_each(NEW.`affected_series_json`)
          )
          AND `generated_series`.`input_fingerprint` <> NEW.`input_fingerprint`
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_derived_assembly_combinations` AS `combination`
        LEFT JOIN `catalog_skus` AS `hose`
          ON `hose`.`import_id` = `release`.`source_import_id`
         AND `hose`.`sku` = `combination`.`hose_sku`
         AND `hose`.`product_type` = 'hose'
         AND `hose`.`hose_series` = `combination`.`hose_series`
        LEFT JOIN `catalog_compatibilities` AS `end_a`
          ON `end_a`.`import_id` = `release`.`source_import_id`
         AND `end_a`.`compatibility_id` = `combination`.`end_a_compatibility_id`
         AND `end_a`.`hose_sku` = `combination`.`hose_sku`
         AND `end_a`.`hose_end_sku` = `combination`.`end_a_hose_end_sku`
         AND `end_a`.`ferrule_sku` = `combination`.`end_a_ferrule_sku`
        LEFT JOIN `catalog_compatibilities` AS `end_b`
          ON `end_b`.`import_id` = `release`.`source_import_id`
         AND `end_b`.`compatibility_id` = `combination`.`end_b_compatibility_id`
         AND `end_b`.`hose_sku` = `combination`.`hose_sku`
         AND `end_b`.`hose_end_sku` = `combination`.`end_b_hose_end_sku`
         AND `end_b`.`ferrule_sku` = `combination`.`end_b_ferrule_sku`
        WHERE `combination`.`release_id` = `release`.`id`
          AND (
            `combination`.`source_import_id` <> `release`.`source_import_id`
            OR `hose`.`sku` IS NULL
            OR `hose`.`catalog_publication_status` <> 'Published'
            OR `hose`.`rfq_eligibility` <> 'Eligible'
            OR `hose`.`supply_availability` <> 'available_for_quote'
            OR `end_a`.`compatibility_id` IS NULL
            OR `end_a`.`catalog_publication_status` <> 'Published'
            OR `end_a`.`rfq_eligibility` <> 'Eligible'
            OR `end_b`.`compatibility_id` IS NULL
            OR `end_b`.`catalog_publication_status` <> 'Published'
            OR `end_b`.`rfq_eligibility` <> 'Eligible'
            OR NOT EXISTS (
              SELECT 1 FROM `catalog_hose_variants` AS `detail`
              WHERE `detail`.`import_id` = `release`.`source_import_id`
                AND `detail`.`sku` = `combination`.`hose_sku`
            )
            OR NOT EXISTS (
              SELECT 1
              FROM `catalog_skus` AS `component`
              INNER JOIN `catalog_hose_ends` AS `detail`
                ON `detail`.`import_id` = `component`.`import_id`
               AND `detail`.`sku` = `component`.`sku`
              WHERE `component`.`import_id` = `release`.`source_import_id`
                AND `component`.`sku` = `combination`.`end_a_hose_end_sku`
                AND `component`.`product_type` = 'hose_end'
                AND `component`.`catalog_publication_status` = 'Published'
                AND `component`.`rfq_eligibility` = 'Eligible'
                AND `component`.`supply_availability` = 'available_for_quote'
            )
            OR NOT EXISTS (
              SELECT 1
              FROM `catalog_skus` AS `component`
              INNER JOIN `catalog_hose_ends` AS `detail`
                ON `detail`.`import_id` = `component`.`import_id`
               AND `detail`.`sku` = `component`.`sku`
              WHERE `component`.`import_id` = `release`.`source_import_id`
                AND `component`.`sku` = `combination`.`end_b_hose_end_sku`
                AND `component`.`product_type` = 'hose_end'
                AND `component`.`catalog_publication_status` = 'Published'
                AND `component`.`rfq_eligibility` = 'Eligible'
                AND `component`.`supply_availability` = 'available_for_quote'
            )
            OR NOT EXISTS (
              SELECT 1
              FROM `catalog_skus` AS `component`
              INNER JOIN `catalog_ferrules` AS `detail`
                ON `detail`.`import_id` = `component`.`import_id`
               AND `detail`.`sku` = `component`.`sku`
              WHERE `component`.`import_id` = `release`.`source_import_id`
                AND `component`.`sku` = `combination`.`end_a_ferrule_sku`
                AND `component`.`product_type` = 'ferrule'
                AND `component`.`catalog_publication_status` = 'Published'
                AND `component`.`rfq_eligibility` = 'Eligible'
                AND `component`.`supply_availability` = 'available_for_quote'
            )
            OR NOT EXISTS (
              SELECT 1
              FROM `catalog_skus` AS `component`
              INNER JOIN `catalog_ferrules` AS `detail`
                ON `detail`.`import_id` = `component`.`import_id`
               AND `detail`.`sku` = `component`.`sku`
              WHERE `component`.`import_id` = `release`.`source_import_id`
                AND `component`.`sku` = `combination`.`end_b_ferrule_sku`
                AND `component`.`product_type` = 'ferrule'
                AND `component`.`catalog_publication_status` = 'Published'
                AND `component`.`rfq_eligibility` = 'Eligible'
                AND `component`.`supply_availability` = 'available_for_quote'
            )
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_skus` AS `hose`
        WHERE `hose`.`import_id` = `release`.`source_import_id`
          AND `hose`.`product_type` = 'hose'
          AND (
            SELECT COUNT(*)
            FROM `catalog_derived_assembly_combinations` AS `combination`
            WHERE `combination`.`release_id` = `release`.`id`
              AND `combination`.`hose_sku` = `hose`.`sku`
          ) <> (
            SELECT COUNT(*) * COUNT(*)
            FROM `catalog_compatibilities` AS `relationship`
            INNER JOIN `catalog_hose_variants` AS `hose_detail`
              ON `hose_detail`.`import_id` = `hose`.`import_id`
             AND `hose_detail`.`sku` = `hose`.`sku`
            INNER JOIN `catalog_skus` AS `hose_end`
              ON `hose_end`.`import_id` = `relationship`.`import_id`
             AND `hose_end`.`sku` = `relationship`.`hose_end_sku`
            INNER JOIN `catalog_hose_ends` AS `hose_end_detail`
              ON `hose_end_detail`.`import_id` = `hose_end`.`import_id`
             AND `hose_end_detail`.`sku` = `hose_end`.`sku`
            INNER JOIN `catalog_skus` AS `ferrule`
              ON `ferrule`.`import_id` = `relationship`.`import_id`
             AND `ferrule`.`sku` = `relationship`.`ferrule_sku`
            INNER JOIN `catalog_ferrules` AS `ferrule_detail`
              ON `ferrule_detail`.`import_id` = `ferrule`.`import_id`
             AND `ferrule_detail`.`sku` = `ferrule`.`sku`
            WHERE `relationship`.`import_id` = `release`.`source_import_id`
              AND `relationship`.`hose_sku` = `hose`.`sku`
              AND `relationship`.`catalog_publication_status` = 'Published'
              AND `relationship`.`rfq_eligibility` = 'Eligible'
              AND `hose`.`catalog_publication_status` = 'Published'
              AND `hose`.`rfq_eligibility` = 'Eligible'
              AND `hose`.`supply_availability` = 'available_for_quote'
              AND `hose_end`.`product_type` = 'hose_end'
              AND `hose_end`.`catalog_publication_status` = 'Published'
              AND `hose_end`.`rfq_eligibility` = 'Eligible'
              AND `hose_end`.`supply_availability` = 'available_for_quote'
              AND `ferrule`.`product_type` = 'ferrule'
              AND `ferrule`.`catalog_publication_status` = 'Published'
              AND `ferrule`.`rfq_eligibility` = 'Eligible'
              AND `ferrule`.`supply_availability` = 'available_for_quote'
          )
      )
  ) THEN RAISE(ABORT, 'derived Assembly Data consistency check failed') END;
END;
--> statement-breakpoint
CREATE TRIGGER `catalogskus_stale_assembly_insert`
AFTER INSERT ON `catalog_skus`
WHEN NEW.`product_type` IN ('hose', 'hose_end', 'ferrule')
BEGIN
  UPDATE `catalog_assembly_impact_analyses`
  SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `catalogskus_stale_assembly_delete`
AFTER DELETE ON `catalog_skus`
WHEN OLD.`product_type` IN ('hose', 'hose_end', 'ferrule')
BEGIN
  UPDATE `catalog_assembly_impact_analyses`
  SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `catalogskus_stale_assembly_update`
AFTER UPDATE OF `sku`, `product_type`, `hose_series`,
  `catalog_publication_status`, `rfq_eligibility`, `supply_availability`
ON `catalog_skus`
WHEN OLD.`sku` IS NOT NEW.`sku`
  OR OLD.`product_type` IS NOT NEW.`product_type`
  OR OLD.`hose_series` IS NOT NEW.`hose_series`
  OR OLD.`catalog_publication_status` IS NOT NEW.`catalog_publication_status`
  OR OLD.`rfq_eligibility` IS NOT NEW.`rfq_eligibility`
  OR OLD.`supply_availability` IS NOT NEW.`supply_availability`
BEGIN
  UPDATE `catalog_assembly_impact_analyses`
  SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` IN (OLD.`import_id`, NEW.`import_id`)
      AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_stale_assembly_insert`
AFTER INSERT ON `catalog_hose_variants`
BEGIN
  UPDATE `catalog_assembly_impact_analyses` SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_stale_assembly_delete`
AFTER DELETE ON `catalog_hose_variants`
BEGIN
  UPDATE `catalog_assembly_impact_analyses` SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_stale_assembly_insert`
AFTER INSERT ON `catalog_hose_ends`
BEGIN
  UPDATE `catalog_assembly_impact_analyses` SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_stale_assembly_delete`
AFTER DELETE ON `catalog_hose_ends`
BEGIN
  UPDATE `catalog_assembly_impact_analyses` SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `catalogferrules_stale_assembly_insert`
AFTER INSERT ON `catalog_ferrules`
BEGIN
  UPDATE `catalog_assembly_impact_analyses` SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `catalogferrules_stale_assembly_delete`
AFTER DELETE ON `catalog_ferrules`
BEGIN
  UPDATE `catalog_assembly_impact_analyses` SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_stale_assembly_insert`
AFTER INSERT ON `catalog_compatibilities`
BEGIN
  UPDATE `catalog_assembly_impact_analyses`
  SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_stale_assembly_delete`
AFTER DELETE ON `catalog_compatibilities`
BEGIN
  UPDATE `catalog_assembly_impact_analyses`
  SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `catalogcompatibilities_stale_assembly_update`
AFTER UPDATE OF `compatibility_id`, `hose_sku`, `hose_end_sku`, `ferrule_sku`,
  `assembly_method`, `skive_requirement`, `outer_skive_length_mm`,
  `inner_skive_length_mm`, `insertion_depth_mm`, `crimp_program`,
  `final_crimp_diameter_mm`, `tolerance_mm`, `measurement_location`,
  `assembly_working_bar`, `proof_pressure_bar`, `proof_hold_seconds`,
  `qualification_id`, `qualification_status`, `rfq_eligibility`,
  `technical_data_status`, `catalog_publication_status`
ON `catalog_compatibilities`
WHEN OLD.`compatibility_id` IS NOT NEW.`compatibility_id`
  OR OLD.`hose_sku` IS NOT NEW.`hose_sku`
  OR OLD.`hose_end_sku` IS NOT NEW.`hose_end_sku`
  OR OLD.`ferrule_sku` IS NOT NEW.`ferrule_sku`
  OR OLD.`assembly_method` IS NOT NEW.`assembly_method`
  OR OLD.`skive_requirement` IS NOT NEW.`skive_requirement`
  OR OLD.`outer_skive_length_mm` IS NOT NEW.`outer_skive_length_mm`
  OR OLD.`inner_skive_length_mm` IS NOT NEW.`inner_skive_length_mm`
  OR OLD.`insertion_depth_mm` IS NOT NEW.`insertion_depth_mm`
  OR OLD.`crimp_program` IS NOT NEW.`crimp_program`
  OR OLD.`final_crimp_diameter_mm` IS NOT NEW.`final_crimp_diameter_mm`
  OR OLD.`tolerance_mm` IS NOT NEW.`tolerance_mm`
  OR OLD.`measurement_location` IS NOT NEW.`measurement_location`
  OR OLD.`assembly_working_bar` IS NOT NEW.`assembly_working_bar`
  OR OLD.`proof_pressure_bar` IS NOT NEW.`proof_pressure_bar`
  OR OLD.`proof_hold_seconds` IS NOT NEW.`proof_hold_seconds`
  OR OLD.`qualification_id` IS NOT NEW.`qualification_id`
  OR OLD.`qualification_status` IS NOT NEW.`qualification_status`
  OR OLD.`rfq_eligibility` IS NOT NEW.`rfq_eligibility`
  OR OLD.`technical_data_status` IS NOT NEW.`technical_data_status`
  OR OLD.`catalog_publication_status` IS NOT NEW.`catalog_publication_status`
BEGIN
  UPDATE `catalog_assembly_impact_analyses`
  SET `status` = 'stale'
  WHERE `release_id` IN (
    SELECT `id` FROM `catalog_releases`
    WHERE `source_import_id` IN (OLD.`import_id`, NEW.`import_id`)
      AND `status` = 'draft'
  );
END;
--> statement-breakpoint

UPDATE `application_schema_state`
SET `version` = 49, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
