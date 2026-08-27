UPDATE `configurator_registry_seed_templates`
SET `payload_json` = json_set(
  `payload_json`,
  '$.diagramAssetKey', replace(json_extract(`payload_json`, '$.diagramAssetKey'), '.png', '.jpg'),
  '$.diagramAssetVersion', '1.0.1-draft'
)
WHERE `registry_type` = 'measurement_method';
--> statement-breakpoint
UPDATE `catalog_configurator_registry_entries`
SET
  `payload_json` = json_set(
    `payload_json`,
    '$.diagramAssetKey', replace(json_extract(`payload_json`, '$.diagramAssetKey'), '.png', '.jpg'),
    '$.diagramAssetVersion', '1.0.1-draft'
  ),
  `record_version` = `record_version` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `registry_type` = 'measurement_method'
  AND `release_id` IN (
    SELECT `id` FROM `catalog_releases` WHERE `status` = 'draft'
  );
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 15, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
