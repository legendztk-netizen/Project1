INSERT INTO `configurator_registry_seed_templates`
  (`registry_type`, `entry_key`, `payload_json`)
VALUES
  ('installed_protection', 'NYLON', '{"code":"NYLON","publicName":"Nylon Protective Sleeving","specification":"Abrasion-resistant nylon sleeve installed over the finished hose assembly","availability":"available","isNoAdditionalProtection":false,"currency":"USD","referencePriceUsd":null,"referenceBasePriceUsd":8,"referenceMaterialPricePerFootUsd":1.35,"referenceInstallationPricePerStartedFootUsd":1}'),
  ('installed_protection', 'SPIRAL', '{"code":"SPIRAL","publicName":"Plastic Spiral Guard","specification":"Plastic spiral abrasion guard installed over the finished hose assembly","availability":"available","isNoAdditionalProtection":false,"currency":"USD","referencePriceUsd":null,"referenceBasePriceUsd":8,"referenceMaterialPricePerFootUsd":1,"referenceInstallationPricePerStartedFootUsd":1}')
ON CONFLICT (`registry_type`, `entry_key`) DO UPDATE SET
  `payload_json` = excluded.`payload_json`;
--> statement-breakpoint
UPDATE `configurator_registry_seed_templates`
SET `payload_json` = json_set(
  `payload_json`,
  '$.referenceBasePriceUsd', 0,
  '$.referenceMaterialPricePerFootUsd', 0,
  '$.referenceInstallationPricePerStartedFootUsd', 0
)
WHERE `registry_type` = 'installed_protection' AND `entry_key` = 'NONE';
--> statement-breakpoint
UPDATE `configurator_registry_seed_templates`
SET `payload_json` = json_set(
  `payload_json`,
  '$.assemblyServicePricePerStartedFootUsd', 0.5
)
WHERE `registry_type` = 'assembly_estimate_schedule' AND `entry_key` = 'DEFAULT';
--> statement-breakpoint
INSERT INTO `catalog_configurator_registry_entries`
  (`release_id`, `registry_type`, `entry_key`, `payload_json`, `record_version`, `updated_at`)
SELECT `catalog_releases`.`id`, `seed`.`registry_type`, `seed`.`entry_key`,
       `seed`.`payload_json`, 1, CURRENT_TIMESTAMP
FROM `catalog_releases`
CROSS JOIN `configurator_registry_seed_templates` AS `seed`
WHERE `seed`.`registry_type` = 'installed_protection'
  AND `seed`.`entry_key` IN ('NYLON', 'SPIRAL')
  AND `catalog_releases`.`status` = 'draft'
ON CONFLICT (`release_id`, `registry_type`, `entry_key`) DO UPDATE SET
  `payload_json` = excluded.`payload_json`,
  `record_version` = `record_version` + 1,
  `updated_at` = CURRENT_TIMESTAMP;
--> statement-breakpoint
UPDATE `catalog_configurator_registry_entries`
SET
  `payload_json` = json_set(
    `payload_json`,
    '$.referenceBasePriceUsd', 0,
    '$.referenceMaterialPricePerFootUsd', 0,
    '$.referenceInstallationPricePerStartedFootUsd', 0
  ),
  `record_version` = `record_version` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `registry_type` = 'installed_protection' AND `entry_key` = 'NONE'
  AND `release_id` IN (
    SELECT `id` FROM `catalog_releases` WHERE `status` = 'draft'
  );
--> statement-breakpoint
UPDATE `catalog_configurator_registry_entries`
SET
  `payload_json` = json_set(
    `payload_json`,
    '$.assemblyServicePricePerStartedFootUsd', 0.5
  ),
  `record_version` = `record_version` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `registry_type` = 'assembly_estimate_schedule' AND `entry_key` = 'DEFAULT'
  AND `release_id` IN (
    SELECT `id` FROM `catalog_releases` WHERE `status` = 'draft'
  );
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 16, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
