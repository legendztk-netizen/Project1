CREATE TABLE `pending_configuration_save_limits` (
  `scope_key` text PRIMARY KEY NOT NULL,
  `attempt_count` integer NOT NULL DEFAULT 1
    CHECK (`attempt_count` > 0),
  `window_expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_configuration_save_limits_expiry_idx`
ON `pending_configuration_save_limits` (`window_expires_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 19, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
