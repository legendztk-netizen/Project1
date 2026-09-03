UPDATE `seller_return_locations`
SET `address` = replace(`address`, '\n', char(10))
WHERE instr(`address`, '\n') > 0;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 43, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
