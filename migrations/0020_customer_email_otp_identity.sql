CREATE TABLE `customer_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`email_normalized` text NOT NULL,
	`email_display` text NOT NULL,
	`email_verified_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_profiles_email_uq`
ON `customer_profiles` (`email_normalized`);
--> statement-breakpoint
CREATE TABLE `customer_otp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`email_normalized` text NOT NULL,
	`purpose` text NOT NULL,
	`otp_digest` text NOT NULL,
	`request_ip_digest` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`consumption_nonce` text,
	`superseded_at` text,
	CONSTRAINT `customer_otp_challenge_purpose`
		CHECK (`purpose` IN ('register', 'sign_in')),
	CONSTRAINT `customer_otp_challenge_failed_attempts`
		CHECK (`failed_attempts` BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX `customer_otp_challenges_email_created_idx`
ON `customer_otp_challenges` (`email_normalized`,`created_at`);
--> statement-breakpoint
CREATE INDEX `customer_otp_challenges_ip_created_idx`
ON `customer_otp_challenges` (`request_ip_digest`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `customer_otp_challenges_enforce_request_limits`
BEFORE INSERT ON `customer_otp_challenges`
BEGIN
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `customer_otp_challenges`
		WHERE `email_normalized` = NEW.`email_normalized`
			AND unixepoch(`created_at`) > unixepoch(NEW.`created_at`) - 60
	) THEN RAISE(ABORT, 'CUSTOMER_OTP_COOLDOWN') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_otp_challenges`
		WHERE `email_normalized` = NEW.`email_normalized`
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 3600
	) >= 5 THEN RAISE(ABORT, 'CUSTOMER_OTP_EMAIL_RATE_LIMIT') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_otp_challenges`
		WHERE `request_ip_digest` = NEW.`request_ip_digest`
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 3600
	) >= 20 THEN RAISE(ABORT, 'CUSTOMER_OTP_IP_RATE_LIMIT') END;
END;
--> statement-breakpoint
CREATE TABLE `customer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_sessions_token_uq`
ON `customer_sessions` (`token_digest`);
--> statement-breakpoint
CREATE INDEX `customer_sessions_profile_active_idx`
ON `customer_sessions` (`profile_id`,`expires_at`,`revoked_at`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 21, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
