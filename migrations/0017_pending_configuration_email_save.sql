CREATE TABLE `pending_configuration_drafts` (
  `id` text PRIMARY KEY NOT NULL,
  `save_identity` text NOT NULL,
  `email` text NOT NULL,
  `catalog_release_id` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `version_snapshot_json` text NOT NULL,
  `status` text NOT NULL
    CHECK (`status` IN ('pending_verification', 'verified')),
  `verification_token_hash` text NOT NULL,
  `verification_expires_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `verified_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`catalog_release_id`) REFERENCES `catalog_releases`(`id`)
    ON UPDATE no action ON DELETE no action,
  CONSTRAINT `pending_configuration_email_lowercase`
    CHECK (`email` = lower(`email`)),
  CONSTRAINT `pending_configuration_snapshot_json`
    CHECK (json_valid(`snapshot_json`)),
  CONSTRAINT `pending_configuration_version_json`
    CHECK (json_valid(`version_snapshot_json`))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_configuration_drafts_identity_uq`
ON `pending_configuration_drafts` (`save_identity`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_configuration_drafts_token_uq`
ON `pending_configuration_drafts` (`verification_token_hash`);
--> statement-breakpoint
CREATE INDEX `pending_configuration_drafts_expiry_idx`
ON `pending_configuration_drafts` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `pending_configuration_email_effects` (
  `id` text PRIMARY KEY NOT NULL,
  `pending_configuration_id` text NOT NULL,
  `status` text NOT NULL
    CHECK (`status` IN ('pending', 'dispatching', 'queued', 'sent')),
  `sent_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`pending_configuration_id`)
    REFERENCES `pending_configuration_drafts`(`id`)
    ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_configuration_email_effects_draft_uq`
ON `pending_configuration_email_effects` (`pending_configuration_id`);
--> statement-breakpoint
CREATE INDEX `pending_configuration_email_effects_status_idx`
ON `pending_configuration_email_effects` (`status`, `updated_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 18, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
