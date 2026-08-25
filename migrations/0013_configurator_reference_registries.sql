CREATE TABLE `configurator_registry_seed_templates` (
  `registry_type` text NOT NULL,
  `entry_key` text NOT NULL,
  `payload_json` text NOT NULL CHECK (json_valid(`payload_json`)),
  PRIMARY KEY (`registry_type`, `entry_key`),
  CONSTRAINT `configurator_seed_registry_type` CHECK (`registry_type` IN (
    'endpoint_class', 'endpoint_assignment', 'measurement_method',
    'measurement_mapping', 'clocking_convention', 'installed_protection',
    'protection_rule', 'assembly_estimate_schedule'
  ))
);
--> statement-breakpoint
CREATE TABLE `catalog_configurator_registry_entries` (
  `release_id` text NOT NULL REFERENCES `catalog_releases` (`id`),
  `registry_type` text NOT NULL,
  `entry_key` text NOT NULL,
  `payload_json` text NOT NULL CHECK (json_valid(`payload_json`)),
  `record_version` integer NOT NULL DEFAULT 1 CHECK (`record_version` > 0),
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`release_id`, `registry_type`, `entry_key`),
  CONSTRAINT `catalog_configurator_registry_type` CHECK (`registry_type` IN (
    'endpoint_class', 'endpoint_assignment', 'measurement_method',
    'measurement_mapping', 'clocking_convention', 'installed_protection',
    'protection_rule', 'assembly_estimate_schedule'
  ))
);
--> statement-breakpoint
CREATE INDEX `catalog_configurator_registry_release_type_idx`
ON `catalog_configurator_registry_entries` (`release_id`, `registry_type`);
--> statement-breakpoint
INSERT INTO `configurator_registry_seed_templates`
  (`registry_type`, `entry_key`, `payload_json`)
VALUES
  ('endpoint_class', 'STRAIGHT_MALE_END', '{"code":"STRAIGHT_MALE_END","displayName":"Straight male end point","referenceKind":"defined_straight_male_end_point"}'),
  ('endpoint_class', 'STRAIGHT_CONICAL_SEAT', '{"code":"STRAIGHT_CONICAL_SEAT","displayName":"Straight conical sealing surface","referenceKind":"conical_sealing_surface"}'),
  ('endpoint_class', 'STRAIGHT_SEALING_REFERENCE', '{"code":"STRAIGHT_SEALING_REFERENCE","displayName":"Straight sealing reference","referenceKind":"straight_end_sealing_reference"}'),
  ('endpoint_class', 'ELBOW_45_CENTERLINE', '{"code":"ELBOW_45_CENTERLINE","displayName":"45 degree elbow centerline intersection","referenceKind":"elbow_centerline_and_sealing_surface_intersection"}'),
  ('endpoint_class', 'ELBOW_90_CENTERLINE', '{"code":"ELBOW_90_CENTERLINE","displayName":"90 degree elbow centerline intersection","referenceKind":"elbow_centerline_and_sealing_surface_intersection"}'),
  ('endpoint_class', 'FLAT_SEALING_PLANE', '{"code":"FLAT_SEALING_PLANE","displayName":"Flat sealing plane","referenceKind":"flat_sealing_plane"}'),
  ('measurement_method', 'M01', '{"code":"M01","displayName":"Straight male to straight male","endpointRule":"Defined straight male end point to defined straight male end point","diagramAssetKey":"M01-straight-male-to-straight-male.png","overlayVersion":"1.0.1-draft"}'),
  ('measurement_method', 'M02', '{"code":"M02","displayName":"Conical seat to conical seat","endpointRule":"Conical sealing surface to conical sealing surface","diagramAssetKey":"M02-female-seat-to-female-seat.png","overlayVersion":"1.0.1-draft"}'),
  ('measurement_method', 'M03', '{"code":"M03","displayName":"Straight to 45 degree elbow","endpointRule":"Straight sealing reference to elbow centerline and sealing-surface intersection","diagramAssetKey":"M03-straight-to-45-elbow.png","overlayVersion":"1.0.1-draft"}'),
  ('measurement_method', 'M04', '{"code":"M04","displayName":"Straight to 90 degree elbow","endpointRule":"Straight sealing reference to elbow centerline and sealing-surface intersection","diagramAssetKey":"M04-straight-to-90-elbow.png","overlayVersion":"1.0.1-draft"}'),
  ('measurement_method', 'M05', '{"code":"M05","displayName":"45 degree elbow to 45 degree elbow","endpointRule":"Elbow centerline intersection to elbow centerline intersection","diagramAssetKey":"M05-45-elbow-to-45-elbow.png","overlayVersion":"1.0.1-draft"}'),
  ('measurement_method', 'M06', '{"code":"M06","displayName":"90 degree elbow to 90 degree elbow","endpointRule":"Elbow centerline intersection to elbow centerline intersection","diagramAssetKey":"M06-90-elbow-to-90-elbow.png","overlayVersion":"1.0.1-draft"}'),
  ('measurement_method', 'M07', '{"code":"M07","displayName":"ORFS flat face to flat face","endpointRule":"Flat sealing plane to flat sealing plane","diagramAssetKey":"M07-orfs-flat-face-to-flat-face.png","overlayVersion":"1.0.1-draft"}'),
  ('measurement_mapping', 'STRAIGHT_MALE_END:STRAIGHT_MALE_END', '{"id":"STRAIGHT_MALE_END:STRAIGHT_MALE_END","endAClassCode":"STRAIGHT_MALE_END","endBClassCode":"STRAIGHT_MALE_END","methodCode":"M01","guidanceStatus":"guided"}'),
  ('measurement_mapping', 'STRAIGHT_CONICAL_SEAT:STRAIGHT_CONICAL_SEAT', '{"id":"STRAIGHT_CONICAL_SEAT:STRAIGHT_CONICAL_SEAT","endAClassCode":"STRAIGHT_CONICAL_SEAT","endBClassCode":"STRAIGHT_CONICAL_SEAT","methodCode":"M02","guidanceStatus":"guided"}'),
  ('measurement_mapping', 'STRAIGHT_SEALING_REFERENCE:ELBOW_45_CENTERLINE', '{"id":"STRAIGHT_SEALING_REFERENCE:ELBOW_45_CENTERLINE","endAClassCode":"STRAIGHT_SEALING_REFERENCE","endBClassCode":"ELBOW_45_CENTERLINE","methodCode":"M03","guidanceStatus":"guided"}'),
  ('measurement_mapping', 'STRAIGHT_SEALING_REFERENCE:ELBOW_90_CENTERLINE', '{"id":"STRAIGHT_SEALING_REFERENCE:ELBOW_90_CENTERLINE","endAClassCode":"STRAIGHT_SEALING_REFERENCE","endBClassCode":"ELBOW_90_CENTERLINE","methodCode":"M04","guidanceStatus":"guided"}'),
  ('measurement_mapping', 'ELBOW_45_CENTERLINE:ELBOW_45_CENTERLINE', '{"id":"ELBOW_45_CENTERLINE:ELBOW_45_CENTERLINE","endAClassCode":"ELBOW_45_CENTERLINE","endBClassCode":"ELBOW_45_CENTERLINE","methodCode":"M05","guidanceStatus":"guided"}'),
  ('measurement_mapping', 'ELBOW_90_CENTERLINE:ELBOW_90_CENTERLINE', '{"id":"ELBOW_90_CENTERLINE:ELBOW_90_CENTERLINE","endAClassCode":"ELBOW_90_CENTERLINE","endBClassCode":"ELBOW_90_CENTERLINE","methodCode":"M06","guidanceStatus":"guided"}'),
  ('measurement_mapping', 'FLAT_SEALING_PLANE:FLAT_SEALING_PLANE', '{"id":"FLAT_SEALING_PLANE:FLAT_SEALING_PLANE","endAClassCode":"FLAT_SEALING_PLANE","endBClassCode":"FLAT_SEALING_PLANE","methodCode":"M07","guidanceStatus":"guided"}'),
  ('clocking_convention', 'M08', '{"code":"M08","viewDirection":"end_a_toward_end_b","zeroReference":"end_b_at_6_oclock","measurementDirection":"clockwise","acceptedMinimumDegrees":0,"acceptedMaximumDegrees":359,"standardToleranceDegrees":3,"presets":[0,45,90,135,180,225,270,315],"notSureOutcome":"manual_review","tighterToleranceOutcome":"manual_review","rendererVersion":"1.0.1-draft"}'),
  ('installed_protection', 'NONE', '{"code":"NONE","publicName":"No additional installed protection","specification":"No additional installed sleeve or guard","availability":"available","isNoAdditionalProtection":true,"currency":"USD","referencePriceUsd":0}'),
  ('assembly_estimate_schedule', 'DEFAULT', '{"currency":"USD","hosePriceSource":"catalog_sales_offer_per_ft","hoseEndPriceSource":"catalog_sales_offer","ferrulePriceSource":"catalog_sales_offer","protectionPriceSource":"installed_protection_registry","assemblyServicePriceUsd":null}');
--> statement-breakpoint
INSERT INTO `catalog_configurator_registry_entries`
  (`release_id`, `registry_type`, `entry_key`, `payload_json`, `record_version`, `updated_at`)
SELECT `catalog_releases`.`id`, `configurator_registry_seed_templates`.`registry_type`,
       `configurator_registry_seed_templates`.`entry_key`,
       `configurator_registry_seed_templates`.`payload_json`, 1,
       `catalog_releases`.`created_at`
FROM `catalog_releases`
CROSS JOIN `configurator_registry_seed_templates`
WHERE `catalog_releases`.`status` = 'draft';
--> statement-breakpoint
CREATE TRIGGER `catalog_releases_seed_configurator_registries`
AFTER INSERT ON `catalog_releases`
WHEN NEW.`status` = 'draft'
BEGIN
  INSERT INTO `catalog_configurator_registry_entries`
    (`release_id`, `registry_type`, `entry_key`, `payload_json`, `record_version`, `updated_at`)
  SELECT NEW.`id`, `registry_type`, `entry_key`, `payload_json`, 1, NEW.`created_at`
  FROM `configurator_registry_seed_templates`;
END;
--> statement-breakpoint
CREATE TRIGGER `catalog_configurator_registry_draft_insert`
BEFORE INSERT ON `catalog_configurator_registry_entries`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = NEW.`release_id` AND `status` = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'published configurator registry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalog_configurator_registry_draft_update`
BEFORE UPDATE ON `catalog_configurator_registry_entries`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'published configurator registry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalog_configurator_registry_draft_delete`
BEFORE DELETE ON `catalog_configurator_registry_entries`
WHEN NOT EXISTS (
  SELECT 1 FROM `catalog_releases`
  WHERE `id` = OLD.`release_id` AND `status` = 'draft'
)
BEGIN
  SELECT RAISE(ABORT, 'published configurator registry is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `catalog_release_registry_precondition`
BEFORE INSERT ON `catalog_release_publications`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `catalog_releases` AS `target_release`
    WHERE `target_release`.`id` = NEW.`release_id`
      AND `target_release`.`status` = 'draft'
      AND (
        SELECT COUNT(*)
        FROM `catalog_configurator_registry_entries`
        WHERE `release_id` = NEW.`release_id`
          AND `registry_type` = 'measurement_method'
          AND `entry_key` IN ('M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07')
          AND json_extract(`payload_json`, '$.code') = `entry_key`
      ) = 7
      AND (
        SELECT COUNT(*)
        FROM `catalog_configurator_registry_entries`
        WHERE `release_id` = NEW.`release_id`
          AND `registry_type` = 'clocking_convention'
          AND `entry_key` = 'M08'
          AND json_extract(`payload_json`, '$.code') = 'M08'
          AND json_extract(`payload_json`, '$.acceptedMinimumDegrees') = 0
          AND json_extract(`payload_json`, '$.acceptedMaximumDegrees') = 359
      ) = 1
      AND (
        SELECT COUNT(*)
        FROM `catalog_configurator_registry_entries`
        WHERE `release_id` = NEW.`release_id`
          AND `registry_type` = 'assembly_estimate_schedule'
          AND `entry_key` = 'DEFAULT'
          AND json_extract(`payload_json`, '$.currency') = 'USD'
      ) = 1
      AND (
        SELECT COUNT(*)
        FROM `catalog_configurator_registry_entries`
        WHERE `release_id` = NEW.`release_id`
          AND `registry_type` = 'installed_protection'
          AND json_extract(`payload_json`, '$.isNoAdditionalProtection') = 1
      ) = 1
      AND (
        SELECT COUNT(*)
        FROM `catalog_configurator_registry_entries`
        WHERE `release_id` = NEW.`release_id`
          AND `registry_type` = 'installed_protection'
          AND `entry_key` = 'NONE'
          AND json_extract(`payload_json`, '$.code') = 'NONE'
          AND json_extract(`payload_json`, '$.isNoAdditionalProtection') = 1
          AND json_extract(`payload_json`, '$.availability') = 'available'
          AND json_extract(`payload_json`, '$.currency') = 'USD'
          AND json_extract(`payload_json`, '$.referencePriceUsd') = 0
      ) = 1
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_configurator_registry_entries` AS `assignment`
        LEFT JOIN `catalog_hose_ends` AS `hose_end`
          ON `hose_end`.`import_id` = `target_release`.`source_import_id`
         AND `hose_end`.`sku` = json_extract(`assignment`.`payload_json`, '$.hoseEndSku')
        WHERE `assignment`.`release_id` = NEW.`release_id`
          AND `assignment`.`registry_type` = 'endpoint_assignment'
          AND `hose_end`.`sku` IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM `catalog_configurator_registry_entries` AS `assignment`
        LEFT JOIN `catalog_configurator_registry_entries` AS `endpoint_class`
          ON `endpoint_class`.`release_id` = `assignment`.`release_id`
         AND `endpoint_class`.`registry_type` = 'endpoint_class'
         AND `endpoint_class`.`entry_key` =
           json_extract(`assignment`.`payload_json`, '$.endpointClassCode')
        WHERE `assignment`.`release_id` = NEW.`release_id`
          AND `assignment`.`registry_type` = 'endpoint_assignment'
          AND `endpoint_class`.`entry_key` IS NULL
      )
  ) THEN RAISE(ABORT, 'catalog configurator registry precondition failed') END;
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 14, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
