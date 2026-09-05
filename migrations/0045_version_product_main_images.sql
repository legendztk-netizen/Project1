CREATE TABLE `catalog_media_lineages` (
  `id` text PRIMARY KEY NOT NULL,
  `logical_reference` text NOT NULL,
  `created_at` text NOT NULL,
  `created_by` text NOT NULL,
  `source_notes` text,
  `license_notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_media_lineages_reference_uq`
ON `catalog_media_lineages` (`logical_reference`);
--> statement-breakpoint
CREATE TABLE `catalog_media_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `lineage_id` text NOT NULL,
  `version` integer NOT NULL,
  `source_kind` text NOT NULL,
  `approved_reference` text,
  `master_object_key` text,
  `storefront_object_key` text,
  `thumbnail_object_key` text,
  `content_hash` text,
  `mime_type` text NOT NULL,
  `width` integer,
  `height` integer,
  `created_at` text NOT NULL,
  `created_by` text NOT NULL,
  FOREIGN KEY (`lineage_id`) REFERENCES `catalog_media_lineages` (`id`) ON DELETE restrict,
  CONSTRAINT `catalog_media_version_number` CHECK (`version` > 0),
  CONSTRAINT `catalog_media_source_kind` CHECK (`source_kind` IN ('approved_reference', 'uploaded')),
  CONSTRAINT `catalog_media_source_shape` CHECK (
    (`source_kind` = 'approved_reference' AND `approved_reference` IS NOT NULL
      AND `master_object_key` IS NULL AND `storefront_object_key` IS NULL
      AND `thumbnail_object_key` IS NULL AND `content_hash` IS NULL)
    OR
    (`source_kind` = 'uploaded' AND `approved_reference` IS NULL
      AND `master_object_key` IS NOT NULL AND `storefront_object_key` IS NOT NULL
      AND `thumbnail_object_key` IS NOT NULL AND `content_hash` IS NOT NULL
      AND `width` IS NOT NULL AND `height` IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_media_versions_lineage_version_uq`
ON `catalog_media_versions` (`lineage_id`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_media_versions_approved_reference_uq`
ON `catalog_media_versions` (`approved_reference`)
WHERE `approved_reference` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `catalog_product_main_images` (
  `id` text PRIMARY KEY NOT NULL,
  `import_id` text NOT NULL,
  `sku` text NOT NULL,
  `media_version_id` text NOT NULL,
  `assigned_at` text NOT NULL,
  `assigned_by` text NOT NULL,
  FOREIGN KEY (`import_id`, `sku`) REFERENCES `catalog_skus` (`import_id`, `sku`) ON DELETE cascade,
  FOREIGN KEY (`media_version_id`) REFERENCES `catalog_media_versions` (`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_product_main_images_import_sku_uq`
ON `catalog_product_main_images` (`import_id`, `sku`);
--> statement-breakpoint
CREATE INDEX `catalog_product_main_images_version_idx`
ON `catalog_product_main_images` (`media_version_id`, `import_id`);
--> statement-breakpoint

WITH image_references AS (
  SELECT DISTINCT CASE product.product_type
    WHEN 'hose' THEN 'hose-series:' || product.hose_series
    WHEN 'hose_end' THEN 'hose-end-shape:' ||
      CASE
        WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) = 'FPX'
          OR hose_end.connection_standard LIKE '%NPSM%' THEN 'NPSM'
        WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) LIKE 'C61%'
          THEN 'SAE Code 61'
        ELSE hose_end.interface_family
      END ||
      CASE WHEN hose_end.gender = 'N/A' THEN '' ELSE '-' || hose_end.gender END ||
      '-' || hose_end.swivel_form || '-' || hose_end.angle ||
      CASE
        WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) IN ('FJX90L', 'FFX90L') THEN '-Long'
        WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) IN ('FJX90M', 'FFX90M') THEN '-Medium'
        ELSE ''
      END
    WHEN 'ferrule' THEN 'catalog-source:62d65f8412ff5.pdf:ferrule:p49-50'
    WHEN 'adapter' THEN 'catalog-source:https://www.discounthydraulichose.com/2404-jic-37-male-x-nptf-male-pipe.html:adapter:straight'
    WHEN 'quick_coupler' THEN 'catalog-source:62d65f8412ff5.pdf:quick-coupler:p52'
  END AS reference
  FROM catalog_skus product
  LEFT JOIN catalog_hose_ends hose_end
    ON hose_end.import_id = product.import_id AND hose_end.sku = product.sku
)
INSERT INTO catalog_media_lineages (
  id, logical_reference, created_at, created_by, source_notes, license_notes
)
SELECT 'approved:' || reference, reference, CURRENT_TIMESTAMP, 'system:migration-0045', NULL, NULL
FROM image_references WHERE reference IS NOT NULL;
--> statement-breakpoint
INSERT INTO catalog_media_versions (
  id, lineage_id, version, source_kind, approved_reference,
  master_object_key, storefront_object_key, thumbnail_object_key,
  content_hash, mime_type, width, height, created_at, created_by
)
SELECT 'approved-v1:' || logical_reference, id, 1, 'approved_reference', logical_reference,
       NULL, NULL, NULL, NULL, 'reference', NULL, NULL, created_at, created_by
FROM catalog_media_lineages;
--> statement-breakpoint
INSERT INTO catalog_product_main_images (
  id, import_id, sku, media_version_id, assigned_at, assigned_by
)
SELECT 'image-assignment:' || product.import_id || ':' || product.sku,
       product.import_id, product.sku,
       'approved-v1:' || CASE product.product_type
         WHEN 'hose' THEN 'hose-series:' || product.hose_series
         WHEN 'hose_end' THEN 'hose-end-shape:' ||
           CASE
             WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) = 'FPX'
               OR hose_end.connection_standard LIKE '%NPSM%' THEN 'NPSM'
             WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) LIKE 'C61%'
               THEN 'SAE Code 61'
             ELSE hose_end.interface_family
           END ||
           CASE WHEN hose_end.gender = 'N/A' THEN '' ELSE '-' || hose_end.gender END ||
           '-' || hose_end.swivel_form || '-' || hose_end.angle ||
           CASE
             WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) IN ('FJX90L', 'FFX90L') THEN '-Long'
             WHEN upper(substr(trim(hose_end.fitting_series), 1, instr(trim(hose_end.fitting_series) || ' ', ' ') - 1)) IN ('FJX90M', 'FFX90M') THEN '-Medium'
             ELSE ''
           END
         WHEN 'ferrule' THEN 'catalog-source:62d65f8412ff5.pdf:ferrule:p49-50'
         WHEN 'adapter' THEN 'catalog-source:https://www.discounthydraulichose.com/2404-jic-37-male-x-nptf-male-pipe.html:adapter:straight'
         WHEN 'quick_coupler' THEN 'catalog-source:62d65f8412ff5.pdf:quick-coupler:p52'
       END,
       CURRENT_TIMESTAMP, 'system:migration-0045'
FROM catalog_skus product
LEFT JOIN catalog_hose_ends hose_end
  ON hose_end.import_id = product.import_id AND hose_end.sku = product.sku;
--> statement-breakpoint

CREATE TRIGGER `catalogproductmainimages_immutable_insert`
BEFORE INSERT ON `catalog_product_main_images`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = NEW.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog image assignment is immutable');
END;
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
CREATE TRIGGER `catalogproductmainimages_immutable_delete`
BEFORE DELETE ON `catalog_product_main_images`
WHEN EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `source_import_id` = OLD.`import_id`
    AND `status` IN ('published', 'superseded')
)
BEGIN
  SELECT RAISE(ABORT, 'published catalog image assignment is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogmediaversions_immutable_update`
BEFORE UPDATE ON `catalog_media_versions`
BEGIN
  SELECT RAISE(ABORT, 'catalog media versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalogmediaversions_immutable_delete`
BEFORE DELETE ON `catalog_media_versions`
BEGIN
  SELECT RAISE(ABORT, 'catalog media versions are immutable');
END;
--> statement-breakpoint

UPDATE `application_schema_state`
SET `version` = 46, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
