CREATE TABLE `configurator_global_registry_entries` (
  `registry_type` text NOT NULL,
  `entry_key` text NOT NULL,
  `payload_json` text NOT NULL CHECK (json_valid(`payload_json`)),
  `record_version` integer NOT NULL DEFAULT 1 CHECK (`record_version` > 0),
  `updated_at` text NOT NULL,
  `updated_by` text NOT NULL,
  `last_operation_id` text NOT NULL,
  PRIMARY KEY (`registry_type`, `entry_key`),
  CONSTRAINT `configurator_global_registry_type` CHECK (`registry_type` IN (
    'measurement_method', 'clocking_convention',
    'installed_protection', 'assembly_estimate_schedule'
  ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `configurator_global_registry_operation_uq`
ON `configurator_global_registry_entries` (`last_operation_id`);
--> statement-breakpoint
CREATE TABLE `configurator_global_registry_entry_versions` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `registry_type` text NOT NULL,
  `entry_key` text NOT NULL,
  `payload_json` text NOT NULL CHECK (json_valid(`payload_json`)),
  `record_version` integer NOT NULL CHECK (`record_version` > 0),
  `changed_at` text NOT NULL,
  `changed_by` text NOT NULL,
  UNIQUE (`registry_type`, `entry_key`, `record_version`)
);
--> statement-breakpoint
CREATE INDEX `configurator_global_registry_history_idx`
ON `configurator_global_registry_entry_versions`
  (`registry_type`, `entry_key`, `record_version` DESC);
--> statement-breakpoint
INSERT INTO `configurator_global_registry_entries` (
  `registry_type`, `entry_key`, `payload_json`, `record_version`,
  `updated_at`, `updated_by`, `last_operation_id`
)
SELECT `entry`.`registry_type`, `entry`.`entry_key`, `entry`.`payload_json`,
       1, CURRENT_TIMESTAMP, 'system:migration-0044',
       'migration-0044:' || `entry`.`registry_type` || ':' || `entry`.`entry_key`
FROM `catalog_configurator_registry_entries` AS `entry`
WHERE `entry`.`release_id` = COALESCE(
  (
    SELECT `active`.`release_id`
    FROM `catalog_active_release` AS `active`
    WHERE `active`.`singleton` = 1
  ),
  (
    SELECT `release`.`id`
    FROM `catalog_releases` AS `release`
    WHERE `release`.`status` = 'draft'
    ORDER BY `release`.`created_at` DESC, `release`.`id` DESC
    LIMIT 1
  )
)
AND `entry`.`registry_type` IN (
  'measurement_method', 'clocking_convention',
  'installed_protection', 'assembly_estimate_schedule'
);
--> statement-breakpoint
INSERT OR IGNORE INTO `configurator_global_registry_entries` (
  `registry_type`, `entry_key`, `payload_json`, `record_version`,
  `updated_at`, `updated_by`, `last_operation_id`
)
SELECT `seed`.`registry_type`, `seed`.`entry_key`, `seed`.`payload_json`,
       1, CURRENT_TIMESTAMP, 'system:migration-0044',
       'migration-0044:' || `seed`.`registry_type` || ':' || `seed`.`entry_key`
FROM `configurator_registry_seed_templates` AS `seed`
WHERE `seed`.`registry_type` IN (
  'measurement_method', 'clocking_convention',
  'installed_protection', 'assembly_estimate_schedule'
);
--> statement-breakpoint
INSERT INTO `configurator_global_registry_entry_versions` (
  `operation_id`, `registry_type`, `entry_key`, `payload_json`,
  `record_version`, `changed_at`, `changed_by`
)
SELECT `last_operation_id`, `registry_type`, `entry_key`, `payload_json`,
       `record_version`, `updated_at`, `updated_by`
FROM `configurator_global_registry_entries`;
--> statement-breakpoint
CREATE TRIGGER `configurator_global_registry_history_immutable_update`
BEFORE UPDATE ON `configurator_global_registry_entry_versions`
BEGIN
  SELECT RAISE(ABORT, 'global configurator history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `configurator_global_registry_history_immutable_delete`
BEFORE DELETE ON `configurator_global_registry_entry_versions`
BEGIN
  SELECT RAISE(ABORT, 'global configurator history is immutable');
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 45, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
