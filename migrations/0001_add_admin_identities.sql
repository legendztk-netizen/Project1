CREATE TABLE `admin_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`account_type` text NOT NULL,
	`status` text NOT NULL,
	`can_manage_subaccounts` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "admin_identity_account_type" CHECK("admin_identities"."account_type" in ('owner', 'subaccount')),
	CONSTRAINT "admin_identity_email_lowercase" CHECK("admin_identities"."email" = lower("admin_identities"."email")),
	CONSTRAINT "admin_identity_status" CHECK("admin_identities"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_identities_email_uq` ON `admin_identities` (`email`);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 2, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
