DROP TRIGGER `customer_password_attempts_enforce_limits`;
--> statement-breakpoint
CREATE TRIGGER `customer_password_attempts_enforce_limits`
BEFORE INSERT ON `customer_password_attempts`
BEGIN
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_password_attempts`
		WHERE `email_digest` = NEW.`email_digest`
			AND `succeeded_at` IS NULL
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 900
	) >= 10 THEN RAISE(ABORT, 'CUSTOMER_PASSWORD_EMAIL_RATE_LIMIT') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `customer_password_attempts`
		WHERE `request_ip_digest` = NEW.`request_ip_digest`
			AND `succeeded_at` IS NULL
			AND unixepoch(`created_at`) >= unixepoch(NEW.`created_at`) - 900
	) >= 30 THEN RAISE(ABORT, 'CUSTOMER_PASSWORD_IP_RATE_LIMIT') END;
END;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 24, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
