CREATE TABLE `seller_identity_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `version` integer NOT NULL,
  `legal_name` text NOT NULL,
  `registered_address_en` text,
  `registered_country_code` text NOT NULL DEFAULT 'CN',
  `status` text NOT NULL,
  `command_id` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `superseded_at` text,
  CONSTRAINT `seller_identity_legal_name`
    CHECK (`legal_name` = 'Hangzhou Rongyao Trading Co., Ltd.'),
  CONSTRAINT `seller_identity_country`
    CHECK (`registered_country_code` = 'CN'),
  CONSTRAINT `seller_identity_status`
    CHECK (`status` IN ('current', 'superseded')),
  CONSTRAINT `seller_identity_address_shape`
    CHECK (`registered_address_en` IS NULL OR length(trim(`registered_address_en`)) > 0),
  CONSTRAINT `seller_identity_superseded_shape`
    CHECK (
      (`status` = 'current' AND `superseded_at` IS NULL) OR
      (`status` = 'superseded' AND `superseded_at` IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_identity_versions_version_uq`
ON `seller_identity_versions` (`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_identity_versions_command_uq`
ON `seller_identity_versions` (`command_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_identity_versions_current_uq`
ON `seller_identity_versions` (`status`) WHERE `status` = 'current';
--> statement-breakpoint
INSERT INTO `seller_identity_versions` (
  `id`, `version`, `legal_name`, `registered_address_en`,
  `registered_country_code`, `status`, `command_id`, `created_by`, `created_at`
) VALUES (
  'seller-identity-initial', 1, 'Hangzhou Rongyao Trading Co., Ltd.', NULL,
  'CN', 'current', 'system-initial-seller-identity', 'system', CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TRIGGER `seller_identity_versions_immutable_update`
BEFORE UPDATE ON `seller_identity_versions`
WHEN
  NEW.`id` IS NOT OLD.`id` OR
  NEW.`version` IS NOT OLD.`version` OR
  NEW.`legal_name` IS NOT OLD.`legal_name` OR
  NEW.`registered_address_en` IS NOT OLD.`registered_address_en` OR
  NEW.`registered_country_code` IS NOT OLD.`registered_country_code` OR
  NEW.`command_id` IS NOT OLD.`command_id` OR
  NEW.`created_by` IS NOT OLD.`created_by` OR
  NEW.`created_at` IS NOT OLD.`created_at` OR
  NOT (OLD.`status` = 'current' AND NEW.`status` = 'superseded') OR
  NOT (OLD.`superseded_at` IS NULL AND NEW.`superseded_at` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'seller identity versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `seller_identity_versions_immutable_delete`
BEFORE DELETE ON `seller_identity_versions`
BEGIN
  SELECT RAISE(ABORT, 'seller identity versions are immutable');
END;
--> statement-breakpoint
CREATE TABLE `seller_payment_instruction_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `channel` text NOT NULL,
  `version` integer NOT NULL,
  `instructions` text NOT NULL,
  `status` text NOT NULL,
  `command_id` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `superseded_at` text,
  CONSTRAINT `seller_payment_channel`
    CHECK (`channel` IN ('bank_transfer', 'paypal')),
  CONSTRAINT `seller_payment_instructions_nonempty`
    CHECK (length(trim(`instructions`)) > 0),
  CONSTRAINT `seller_payment_status`
    CHECK (`status` IN ('current', 'superseded')),
  CONSTRAINT `seller_payment_superseded_shape`
    CHECK (
      (`status` = 'current' AND `superseded_at` IS NULL) OR
      (`status` = 'superseded' AND `superseded_at` IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_payment_instruction_channel_version_uq`
ON `seller_payment_instruction_versions` (`channel`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_payment_instruction_command_uq`
ON `seller_payment_instruction_versions` (`command_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_payment_instruction_current_uq`
ON `seller_payment_instruction_versions` (`channel`)
WHERE `status` = 'current';
--> statement-breakpoint
CREATE TRIGGER `seller_payment_instruction_versions_immutable_update`
BEFORE UPDATE ON `seller_payment_instruction_versions`
WHEN
  NEW.`id` IS NOT OLD.`id` OR
  NEW.`channel` IS NOT OLD.`channel` OR
  NEW.`version` IS NOT OLD.`version` OR
  NEW.`instructions` IS NOT OLD.`instructions` OR
  NEW.`command_id` IS NOT OLD.`command_id` OR
  NEW.`created_by` IS NOT OLD.`created_by` OR
  NEW.`created_at` IS NOT OLD.`created_at` OR
  NOT (OLD.`status` = 'current' AND NEW.`status` = 'superseded') OR
  NOT (OLD.`superseded_at` IS NULL AND NEW.`superseded_at` IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'payment instruction versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `seller_payment_instruction_versions_immutable_delete`
BEFORE DELETE ON `seller_payment_instruction_versions`
BEGIN
  SELECT RAISE(ABORT, 'payment instruction versions are immutable');
END;
--> statement-breakpoint
CREATE TABLE `seller_return_locations` (
  `id` text PRIMARY KEY NOT NULL,
  `label` text NOT NULL,
  `address` text NOT NULL,
  `phone` text NOT NULL,
  `purpose` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `seller_return_locations` (`id`, `label`, `address`, `phone`, `purpose`, `updated_at`)
VALUES (
  'plano-returns', 'Plano Return Location',
  '542 Haggard St, Suite 505\nPlano, TX 75074\nUnited States',
  '+1 6464685429',
  'Approved returns only; not the seller registered address, warehouse, store, sales office, or pickup point.',
  CURRENT_TIMESTAMP
);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 41, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
