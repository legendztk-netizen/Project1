-- Spec 9 Ticket 01: make hose and hose-end series first-class, versioned
-- catalog records. Existing release snapshots remain intact; shared values and
-- representative media are backfilled from their existing variants.

ALTER TABLE `catalog_product_main_images`
ADD COLUMN `assignment_kind` TEXT NOT NULL DEFAULT 'override'
CHECK (`assignment_kind` IN ('inherited', 'override'));
--> statement-breakpoint
DROP TRIGGER `catalogproductmainimages_immutable_update`;
--> statement-breakpoint
UPDATE `catalog_product_main_images` AS `image`
SET `assignment_kind` = 'inherited'
WHERE EXISTS (
  SELECT 1 FROM `catalog_skus` AS `product`
  WHERE `product`.`import_id` = `image`.`import_id`
    AND `product`.`sku` = `image`.`sku`
    AND `product`.`product_type` IN ('hose', 'hose_end')
);
--> statement-breakpoint
CREATE TRIGGER `catalogproductmainimages_immutable_update`
BEFORE UPDATE ON `catalog_product_main_images`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog image assignment is immutable');
END;
--> statement-breakpoint

ALTER TABLE `catalog_hose_series` ADD COLUMN `series_name` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `primary_standard` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `equivalent_standard` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `temp_min_c` REAL;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `temp_max_c` REAL;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `tube_material` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `reinforcement` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `cover_material` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `cover_color` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `cover_finish` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `fluid_compatibility` TEXT;
--> statement-breakpoint
ALTER TABLE `catalog_hose_series` ADD COLUMN `representative_media_version_id` TEXT;
--> statement-breakpoint

-- Temporarily remove the published-snapshot update guard so the migration can
-- enrich existing active and historical snapshots in place. It is restored
-- immediately after the deterministic backfill.
DROP TRIGGER `cataloghoseseries_immutable_update`;
--> statement-breakpoint

UPDATE `catalog_hose_series` AS `series`
SET
  `series_name` = `series`.`series_code`,
  (`primary_standard`, `equivalent_standard`, `temp_min_c`, `temp_max_c`,
   `tube_material`, `reinforcement`, `cover_material`, `cover_color`,
   `cover_finish`, `fluid_compatibility`) = (
    SELECT `primary_standard`, COALESCE(NULLIF(`equivalent_standard`, ''), 'N/A'),
           `temp_min_c`, `temp_max_c`,
           `tube_material`, `reinforcement`, `cover_material`, `cover_color`,
           `cover_finish`, `fluid_compatibility`
    FROM `catalog_hose_variants` AS `variant`
    WHERE `variant`.`import_id` = `series`.`import_id`
      AND `variant`.`hose_series` = `series`.`series_code`
    ORDER BY `variant`.`sku`
    LIMIT 1
  ),
  `representative_media_version_id` = (
    SELECT `image`.`media_version_id`
    FROM `catalog_hose_variants` AS `variant`
    INNER JOIN `catalog_product_main_images` AS `image`
      ON `image`.`import_id` = `variant`.`import_id`
     AND `image`.`sku` = `variant`.`sku`
    WHERE `variant`.`import_id` = `series`.`import_id`
      AND `variant`.`hose_series` = `series`.`series_code`
    ORDER BY `variant`.`sku`
    LIMIT 1
  );
--> statement-breakpoint

CREATE TRIGGER `cataloghoseseries_immutable_update`
BEFORE UPDATE ON `catalog_hose_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog data is immutable');
END;
--> statement-breakpoint

CREATE TABLE `catalog_hose_end_series` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `import_id` TEXT NOT NULL,
  `series_code` TEXT NOT NULL,
  `series_name` TEXT NOT NULL,
  `interface_family` TEXT NOT NULL,
  `connection_standard` TEXT NOT NULL,
  `gender` TEXT NOT NULL,
  `swivel_form` TEXT NOT NULL,
  `angle` TEXT NOT NULL,
  `sealing_form` TEXT NOT NULL,
  `representative_media_version_id` TEXT,
  FOREIGN KEY (`import_id`) REFERENCES `catalog_imports`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`representative_media_version_id`) REFERENCES `catalog_media_versions`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_hose_end_series_import_code_uq`
ON `catalog_hose_end_series` (`import_id`, `series_code`);
--> statement-breakpoint

INSERT INTO `catalog_hose_end_series` (
  `id`, `import_id`, `series_code`, `series_name`, `interface_family`,
  `connection_standard`, `gender`, `swivel_form`, `angle`, `sealing_form`,
  `representative_media_version_id`
)
SELECT
  'hose-end-series:' || `variant`.`import_id` || ':' || `variant`.`fitting_series`,
  `variant`.`import_id`, `variant`.`fitting_series`, `variant`.`fitting_series`,
  `variant`.`interface_family`, `variant`.`connection_standard`, `variant`.`gender`,
  `variant`.`swivel_form`, `variant`.`angle`, `variant`.`sealing_form`,
  (
    SELECT `image`.`media_version_id`
    FROM `catalog_hose_ends` AS `candidate`
    INNER JOIN `catalog_product_main_images` AS `image`
      ON `image`.`import_id` = `candidate`.`import_id`
     AND `image`.`sku` = `candidate`.`sku`
    WHERE `candidate`.`import_id` = `variant`.`import_id`
      AND `candidate`.`fitting_series` = `variant`.`fitting_series`
    ORDER BY `candidate`.`sku`
    LIMIT 1
  )
FROM `catalog_hose_ends` AS `variant`
WHERE `variant`.`sku` = (
  SELECT MIN(`candidate`.`sku`)
  FROM `catalog_hose_ends` AS `candidate`
  WHERE `candidate`.`import_id` = `variant`.`import_id`
    AND `candidate`.`fitting_series` = `variant`.`fitting_series`
);
--> statement-breakpoint

CREATE TRIGGER `cataloghoseseries_code_immutable`
BEFORE UPDATE OF `series_code` ON `catalog_hose_series`
WHEN NEW.`series_code` <> OLD.`series_code`
BEGIN
  SELECT RAISE(ABORT, 'Series Code is immutable / 系列编号不可修改');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_code_immutable`
BEFORE UPDATE OF `series_code` ON `catalog_hose_end_series`
WHEN NEW.`series_code` <> OLD.`series_code`
BEGIN
  SELECT RAISE(ABORT, 'Series Code is immutable / 系列编号不可修改');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_referenced_delete`
BEFORE DELETE ON `catalog_hose_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_hose_variants`
  WHERE `import_id` = OLD.`import_id` AND `hose_series` = OLD.`series_code`
)
BEGIN
  SELECT RAISE(ABORT, 'catalog_series_in_use: Series is referenced by variants / 系列已被子体引用');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_referenced_delete`
BEFORE DELETE ON `catalog_hose_end_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_hose_ends`
  WHERE `import_id` = OLD.`import_id` AND `fitting_series` = OLD.`series_code`
)
BEGIN
  SELECT RAISE(ABORT, 'catalog_series_in_use: Series is referenced by variants / 系列已被子体引用');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_required_insert`
BEFORE INSERT ON `catalog_hose_series`
WHEN NULLIF(trim(NEW.`series_code`), '') IS NULL
  OR NULLIF(trim(NEW.`series_name`), '') IS NULL
  OR NULLIF(trim(NEW.`primary_standard`), '') IS NULL
  OR NULLIF(trim(NEW.`equivalent_standard`), '') IS NULL
  OR NEW.`temp_min_c` IS NULL OR NEW.`temp_max_c` IS NULL
  OR NEW.`representative_media_version_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `catalog_media_versions`
    WHERE `id` = NEW.`representative_media_version_id`
      AND `source_kind` IN ('approved_reference', 'uploaded')
  )
BEGIN
  SELECT RAISE(ABORT, 'Required Hose Series data or reviewed image is missing / 胶管系列必填资料或已审核图片缺失');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseseries_required_update`
BEFORE UPDATE ON `catalog_hose_series`
WHEN NULLIF(trim(NEW.`series_name`), '') IS NULL
  OR NULLIF(trim(NEW.`primary_standard`), '') IS NULL
  OR NULLIF(trim(NEW.`equivalent_standard`), '') IS NULL
  OR NEW.`temp_min_c` IS NULL OR NEW.`temp_max_c` IS NULL
  OR NEW.`representative_media_version_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `catalog_media_versions`
    WHERE `id` = NEW.`representative_media_version_id`
      AND `source_kind` IN ('approved_reference', 'uploaded')
  )
BEGIN
  SELECT RAISE(ABORT, 'Required Hose Series data or reviewed image is missing / 胶管系列必填资料或已审核图片缺失');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_required_insert`
BEFORE INSERT ON `catalog_hose_end_series`
WHEN NULLIF(trim(NEW.`series_code`), '') IS NULL
  OR NULLIF(trim(NEW.`series_name`), '') IS NULL
  OR NULLIF(trim(NEW.`interface_family`), '') IS NULL
  OR NULLIF(trim(NEW.`connection_standard`), '') IS NULL
  OR NULLIF(trim(NEW.`gender`), '') IS NULL
  OR NULLIF(trim(NEW.`swivel_form`), '') IS NULL
  OR NULLIF(trim(NEW.`angle`), '') IS NULL
  OR NULLIF(trim(NEW.`sealing_form`), '') IS NULL
  OR NEW.`representative_media_version_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `catalog_media_versions`
    WHERE `id` = NEW.`representative_media_version_id`
      AND `source_kind` IN ('approved_reference', 'uploaded')
  )
BEGIN
  SELECT RAISE(ABORT, 'Required Hose End Series data or reviewed image is missing / 压接接头系列必填资料或已审核图片缺失');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_required_update`
BEFORE UPDATE ON `catalog_hose_end_series`
WHEN NULLIF(trim(NEW.`series_name`), '') IS NULL
  OR NULLIF(trim(NEW.`interface_family`), '') IS NULL
  OR NULLIF(trim(NEW.`connection_standard`), '') IS NULL
  OR NULLIF(trim(NEW.`gender`), '') IS NULL
  OR NULLIF(trim(NEW.`swivel_form`), '') IS NULL
  OR NULLIF(trim(NEW.`angle`), '') IS NULL
  OR NULLIF(trim(NEW.`sealing_form`), '') IS NULL
  OR NEW.`representative_media_version_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `catalog_media_versions`
    WHERE `id` = NEW.`representative_media_version_id`
      AND `source_kind` IN ('approved_reference', 'uploaded')
  )
BEGIN
  SELECT RAISE(ABORT, 'Required Hose End Series data or reviewed image is missing / 压接接头系列必填资料或已审核图片缺失');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_series_reference_insert`
BEFORE INSERT ON `catalog_hose_variants`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_hose_series`
  WHERE `import_id` = NEW.`import_id` AND `series_code` = NEW.`hose_series`
)
BEGIN
  SELECT RAISE(ABORT, 'Hose Series does not exist / 胶管系列不存在');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghosevariants_series_reference_update`
BEFORE UPDATE OF `import_id`, `hose_series` ON `catalog_hose_variants`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_hose_series`
  WHERE `import_id` = NEW.`import_id` AND `series_code` = NEW.`hose_series`
)
BEGIN
  SELECT RAISE(ABORT, 'Hose Series does not exist / 胶管系列不存在');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_series_reference_insert`
BEFORE INSERT ON `catalog_hose_ends`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_hose_end_series`
  WHERE `import_id` = NEW.`import_id` AND `series_code` = NEW.`fitting_series`
)
BEGIN
  SELECT RAISE(ABORT, 'Hose End Series does not exist / 压接接头系列不存在');
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseends_series_reference_update`
BEFORE UPDATE OF `import_id`, `fitting_series` ON `catalog_hose_ends`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_hose_end_series`
  WHERE `import_id` = NEW.`import_id` AND `series_code` = NEW.`fitting_series`
)
BEGIN
  SELECT RAISE(ABORT, 'Hose End Series does not exist / 压接接头系列不存在');
END;
--> statement-breakpoint

CREATE TRIGGER `cataloghoseendseries_immutable_insert`
BEFORE INSERT ON `catalog_hose_end_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id` AND `status` IN ('published', 'superseded')
)
BEGIN SELECT RAISE(ABORT, 'published catalog data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_immutable_update`
BEFORE UPDATE ON `catalog_hose_end_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id` AND `status` IN ('published', 'superseded')
)
BEGIN SELECT RAISE(ABORT, 'published catalog data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_immutable_delete`
BEFORE DELETE ON `catalog_hose_end_series`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id` AND `status` IN ('published', 'superseded')
)
BEGIN SELECT RAISE(ABORT, 'published catalog data is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_draft_insert_revision`
AFTER INSERT ON `catalog_hose_end_series`
BEGIN
  UPDATE `catalog_releases` SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_draft_update_revision`
AFTER UPDATE ON `catalog_hose_end_series`
BEGIN
  UPDATE `catalog_releases` SET `version` = `version` + 1
  WHERE `source_import_id` = NEW.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint
CREATE TRIGGER `cataloghoseendseries_draft_delete_revision`
AFTER DELETE ON `catalog_hose_end_series`
BEGIN
  UPDATE `catalog_releases` SET `version` = `version` + 1
  WHERE `source_import_id` = OLD.`import_id` AND `status` = 'draft';
END;
--> statement-breakpoint

UPDATE `application_schema_state`
SET `version` = 51, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
