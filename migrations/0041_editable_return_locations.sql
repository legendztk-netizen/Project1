CREATE TABLE `seller_return_location_commands` (
  `command_id` text PRIMARY KEY NOT NULL,
  `location_id` text NOT NULL,
  `operation` text NOT NULL,
  `actor_id` text NOT NULL,
  `occurred_at` text NOT NULL,
  CONSTRAINT `seller_return_location_command_operation`
    CHECK (`operation` IN ('create', 'update')),
  FOREIGN KEY (`location_id`) REFERENCES `seller_return_locations` (`id`)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `seller_return_location_commands_location_idx`
ON `seller_return_location_commands` (`location_id`, `occurred_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 42, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
