CREATE TABLE `customer_delivery_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`label` text NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_email` text NOT NULL,
	`recipient_phone` text NOT NULL,
	`country_code` text NOT NULL,
	`state_province` text NOT NULL,
	`city` text NOT NULL,
	`postal_code` text NOT NULL,
	`address_line_1` text NOT NULL,
	`address_line_2` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	CONSTRAINT `customer_delivery_addresses_country_code`
		CHECK (length(`country_code`) = 2 AND `country_code` = upper(`country_code`)),
	CONSTRAINT `customer_delivery_addresses_required_fields`
		CHECK (
			length(trim(`label`)) > 0 AND
			length(trim(`recipient_name`)) > 0 AND
			length(trim(`recipient_email`)) > 0 AND
			length(trim(`recipient_phone`)) > 0 AND
			length(trim(`state_province`)) > 0 AND
			length(trim(`city`)) > 0 AND
			length(trim(`postal_code`)) > 0 AND
			length(trim(`address_line_1`)) > 0
		)
);
--> statement-breakpoint
CREATE INDEX `customer_delivery_addresses_profile_idx`
ON `customer_delivery_addresses` (`profile_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `customer_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text,
	`country_code` text NOT NULL,
	`registration_or_tax_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `customer_organizations_country_code`
		CHECK (length(`country_code`) = 2 AND `country_code` = upper(`country_code`)),
	CONSTRAINT `customer_organizations_legal_name`
		CHECK (length(trim(`legal_name`)) > 0)
);
--> statement-breakpoint
CREATE TABLE `customer_organization_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `customer_organizations`(`id`) ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	CONSTRAINT `customer_organization_memberships_role`
		CHECK (`role` IN ('primary_contact')),
	CONSTRAINT `customer_organization_memberships_status`
		CHECK (`status` IN ('active', 'inactive'))
);
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
CREATE TABLE `customer_purchasing_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`individual_profile_id` text,
	`organization_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`individual_profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `customer_organizations`(`id`) ON DELETE cascade,
	CONSTRAINT `customer_purchasing_contexts_kind`
		CHECK (`kind` IN ('individual', 'organization')),
	CONSTRAINT `customer_purchasing_contexts_owner_shape`
		CHECK (
			(`kind` = 'individual' AND `individual_profile_id` IS NOT NULL AND `organization_id` IS NULL) OR
			(`kind` = 'organization' AND `individual_profile_id` IS NULL AND `organization_id` IS NOT NULL)
		)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_purchasing_contexts_individual_uq`
ON `customer_purchasing_contexts` (`individual_profile_id`)
WHERE `kind` = 'individual';
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_purchasing_contexts_organization_uq`
ON `customer_purchasing_contexts` (`organization_id`)
WHERE `kind` = 'organization';
--> statement-breakpoint
CREATE TABLE `customer_account_preferences` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`selected_delivery_address_id` text,
	`selected_purchasing_context_id` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `customer_profiles`(`id`) ON DELETE cascade,
	FOREIGN KEY (`selected_delivery_address_id`) REFERENCES `customer_delivery_addresses`(`id`) ON DELETE SET NULL,
	FOREIGN KEY (`selected_purchasing_context_id`) REFERENCES `customer_purchasing_contexts`(`id`) ON DELETE restrict
);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 35, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
