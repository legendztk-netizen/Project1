CREATE UNIQUE INDEX `customer_delivery_addresses_profile_id_uq`
ON `customer_delivery_addresses` (`profile_id`,`id`);
--> statement-breakpoint
CREATE TABLE `customer_organization_memberships_next` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `customer_organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	CONSTRAINT `customer_organization_memberships_role`
		CHECK (`role` IN ('primary_contact', 'member')),
	CONSTRAINT `customer_organization_memberships_status`
		CHECK (`status` IN ('active', 'inactive'))
);
--> statement-breakpoint
INSERT INTO `customer_organization_memberships_next`
	(`id`,`organization_id`,`profile_id`,`role`,`status`,`created_at`)
SELECT `id`,`organization_id`,`profile_id`,`role`,`status`,`created_at`
FROM `customer_organization_memberships`;
--> statement-breakpoint
DROP TABLE `customer_organization_memberships`;
--> statement-breakpoint
ALTER TABLE `customer_organization_memberships_next`
RENAME TO `customer_organization_memberships`;
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_organization_memberships_org_profile_uq`
ON `customer_organization_memberships` (`organization_id`,`profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_organization_memberships_primary_contact_uq`
ON `customer_organization_memberships` (`organization_id`)
WHERE `role` = 'primary_contact' AND `status` = 'active';
--> statement-breakpoint
CREATE INDEX `customer_organization_memberships_profile_idx`
ON `customer_organization_memberships` (`profile_id`,`status`);
--> statement-breakpoint
CREATE TABLE `customer_profile_purchasing_context_access` (
	`profile_id` text NOT NULL,
	`context_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY (`profile_id`,`context_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `customer_purchasing_contexts`(`id`) ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `customer_profile_purchasing_context_access`
	(`profile_id`,`context_id`,`created_at`)
SELECT `individual_profile_id`,`id`,`created_at`
FROM `customer_purchasing_contexts`
WHERE `kind` = 'individual';
--> statement-breakpoint
INSERT INTO `customer_profile_purchasing_context_access`
	(`profile_id`,`context_id`,`created_at`)
SELECT m.`profile_id`,c.`id`,m.`created_at`
FROM `customer_purchasing_contexts` c
INNER JOIN `customer_organization_memberships` m
	ON m.`organization_id` = c.`organization_id`
WHERE c.`kind` = 'organization' AND m.`status` = 'active';
--> statement-breakpoint
CREATE TABLE `customer_account_preferences_next` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`selected_delivery_address_id` text,
	`selected_purchasing_context_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	FOREIGN KEY (`profile_id`,`selected_delivery_address_id`)
		REFERENCES `customer_delivery_addresses`(`profile_id`,`id`),
	FOREIGN KEY (`profile_id`,`selected_purchasing_context_id`)
		REFERENCES `customer_profile_purchasing_context_access`(`profile_id`,`context_id`)
);
--> statement-breakpoint
INSERT INTO `customer_account_preferences_next`
	(`profile_id`,`selected_delivery_address_id`,`selected_purchasing_context_id`,`updated_at`)
SELECT `profile_id`,`selected_delivery_address_id`,`selected_purchasing_context_id`,`updated_at`
FROM `customer_account_preferences`;
--> statement-breakpoint
DROP TABLE `customer_account_preferences`;
--> statement-breakpoint
ALTER TABLE `customer_account_preferences_next`
RENAME TO `customer_account_preferences`;
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 36, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
