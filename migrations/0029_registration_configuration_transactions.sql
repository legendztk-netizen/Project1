CREATE TABLE `customer_registration_configuration_transactions` (
  `id` text PRIMARY KEY NOT NULL,
  `otp_challenge_id` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `abandoned_at` text,
  `converted_at` text,
  CONSTRAINT `registration_configuration_snapshot_json`
    CHECK (json_valid(`snapshot_json`)),
  FOREIGN KEY (`otp_challenge_id`)
    REFERENCES `customer_otp_challenges`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_configuration_challenge_uq`
ON `customer_registration_configuration_transactions` (`otp_challenge_id`);
--> statement-breakpoint
CREATE INDEX `registration_configuration_expiry_idx`
ON `customer_registration_configuration_transactions` (`expires_at`,`converted_at`);
--> statement-breakpoint
CREATE TABLE `customer_saved_configurations` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL,
  `source_registration_transaction_id` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `customer_saved_configuration_snapshot_json`
    CHECK (json_valid(`snapshot_json`)),
  FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
  FOREIGN KEY (`source_registration_transaction_id`)
    REFERENCES `customer_registration_configuration_transactions`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_saved_configuration_source_uq`
ON `customer_saved_configurations` (`source_registration_transaction_id`);
--> statement-breakpoint
CREATE INDEX `customer_saved_configuration_profile_idx`
ON `customer_saved_configurations` (`profile_id`,`updated_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 30, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
