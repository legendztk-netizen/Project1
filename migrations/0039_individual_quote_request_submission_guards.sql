CREATE TABLE `customer_quote_request_submission_guards` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL,
  `session_id` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
  FOREIGN KEY (`session_id`) REFERENCES `anonymous_quote_sessions`(`id`) ON DELETE cascade
);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 40, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
