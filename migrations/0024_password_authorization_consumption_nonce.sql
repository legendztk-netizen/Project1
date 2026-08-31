ALTER TABLE `customer_password_authorizations`
ADD COLUMN `consumption_nonce` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_password_authorizations_consumption_nonce_uq`
ON `customer_password_authorizations` (`consumption_nonce`)
WHERE `consumption_nonce` IS NOT NULL;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 25, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
