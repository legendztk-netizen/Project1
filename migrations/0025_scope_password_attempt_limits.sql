ALTER TABLE `customer_password_attempts`
ADD COLUMN `attempt_kind` text DEFAULT 'password_login' NOT NULL;
--> statement-breakpoint
DROP TRIGGER `customer_password_attempts_enforce_limits`;
--> statement-breakpoint
CREATE TRIGGER `customer_password_attempts_enforce_limits`
BEFORE INSERT ON `customer_password_attempts`
BEGIN
	SELECT CASE WHEN NEW.`attempt_kind` NOT IN (
		'password_login', 'password_change', 'password_reset'
	) THEN RAISE(ABORT, 'CUSTOMER_PASSWORD_ATTEMPT_KIND_INVALID') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_password_attempts`
		WHERE `email_digest` = NEW.`email_digest`
			AND (`attempt_kind` != 'password_login' OR `succeeded_at` IS NULL)
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 900
	) >= 10 THEN RAISE(ABORT, 'CUSTOMER_PASSWORD_EMAIL_RATE_LIMIT') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_password_attempts`
		WHERE `request_ip_digest` = NEW.`request_ip_digest`
			AND (`attempt_kind` != 'password_login' OR `succeeded_at` IS NULL)
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 900
	) >= 30 THEN RAISE(ABORT, 'CUSTOMER_PASSWORD_IP_RATE_LIMIT') END;
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 26, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
