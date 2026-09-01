CREATE TABLE `customer_saved_configurations_next` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL,
  `source_kind` text DEFAULT 'registration' NOT NULL,
  `source_registration_transaction_id` text,
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `customer_saved_configuration_source_kind`
    CHECK (`source_kind` IN ('registration', 'explicit')),
  CONSTRAINT `customer_saved_configuration_source_shape`
    CHECK (
      (`source_kind` = 'registration' AND
       `source_registration_transaction_id` IS NOT NULL) OR
      (`source_kind` = 'explicit' AND
       `source_registration_transaction_id` IS NULL)
    ),
  CONSTRAINT `customer_saved_configuration_snapshot_json`
    CHECK (json_valid(`snapshot_json`)),
  FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
  FOREIGN KEY (`source_registration_transaction_id`)
    REFERENCES `customer_registration_configuration_transactions`(`id`)
);
--> statement-breakpoint
INSERT INTO `customer_saved_configurations_next`
  (`id`, `profile_id`, `source_kind`, `source_registration_transaction_id`,
   `snapshot_json`, `created_at`, `updated_at`)
SELECT `id`, `profile_id`, 'registration', `source_registration_transaction_id`,
       `snapshot_json`, `created_at`, `updated_at`
FROM `customer_saved_configurations`;
--> statement-breakpoint
DROP TABLE `customer_saved_configurations`;
--> statement-breakpoint
ALTER TABLE `customer_saved_configurations_next`
RENAME TO `customer_saved_configurations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_saved_configuration_source_uq`
ON `customer_saved_configurations` (`source_registration_transaction_id`);
--> statement-breakpoint
CREATE INDEX `customer_saved_configuration_profile_idx`
ON `customer_saved_configurations` (`profile_id`,`updated_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 37, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
