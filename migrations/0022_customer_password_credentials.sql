ALTER TABLE `customer_otp_challenges`
ADD COLUMN `authorization_scope` text DEFAULT 'session' NOT NULL
CHECK (`authorization_scope` IN ('session', 'password_change', 'password_reset'));
--> statement-breakpoint
CREATE TABLE `customer_password_credentials` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`algorithm` text NOT NULL,
	`work_factor` integer NOT NULL,
	`salt` text NOT NULL,
	`derived_key` text NOT NULL,
	`hash_bytes` integer NOT NULL,
	`normalization` text NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	CONSTRAINT `customer_password_algorithm`
		CHECK (`algorithm` = 'PBKDF2-HMAC-SHA-256'),
	CONSTRAINT `customer_password_work_factor`
		CHECK (`work_factor` >= 1),
	CONSTRAINT `customer_password_hash_bytes`
		CHECK (`hash_bytes` = 32),
	CONSTRAINT `customer_password_normalization`
		CHECK (`normalization` = 'NFC')
);
--> statement-breakpoint
CREATE TABLE `customer_password_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`scope` text NOT NULL,
	`token_digest` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	CONSTRAINT `customer_password_authorization_scope`
		CHECK (`scope` IN ('password_change', 'password_reset'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_password_authorizations_token_uq`
ON `customer_password_authorizations` (`token_digest`);
--> statement-breakpoint
CREATE INDEX `customer_password_authorizations_profile_idx`
ON `customer_password_authorizations` (`profile_id`,`expires_at`,`consumed_at`);
--> statement-breakpoint
CREATE TABLE `customer_password_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`email_digest` text NOT NULL,
	`request_ip_digest` text NOT NULL,
	`created_at` text NOT NULL,
	`succeeded_at` text
);
--> statement-breakpoint
CREATE INDEX `customer_password_attempts_email_created_idx`
ON `customer_password_attempts` (`email_digest`,`created_at`);
--> statement-breakpoint
CREATE INDEX `customer_password_attempts_ip_created_idx`
ON `customer_password_attempts` (`request_ip_digest`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `customer_password_attempts_enforce_limits`
BEFORE INSERT ON `customer_password_attempts`
BEGIN
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_password_attempts`
		WHERE `email_digest` = NEW.`email_digest`
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 900
	) >= 10 THEN RAISE(ABORT, 'CUSTOMER_PASSWORD_EMAIL_RATE_LIMIT') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_password_attempts`
		WHERE `request_ip_digest` = NEW.`request_ip_digest`
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 900
	) >= 30 THEN RAISE(ABORT, 'CUSTOMER_PASSWORD_IP_RATE_LIMIT') END;
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 23, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
