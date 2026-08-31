CREATE TABLE `quote_reference_discounts` (
  `release_id` text NOT NULL,
  `sku` text NOT NULL,
  `line_kind` text NOT NULL,
  `minimum_quantity` integer NOT NULL,
  `discount_percent` real NOT NULL,
  `record_version` integer NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`release_id`, `sku`, `line_kind`, `minimum_quantity`),
  FOREIGN KEY (`release_id`) REFERENCES `catalog_releases`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `quote_reference_discount_line_kind` CHECK (`line_kind` IN ('standard', 'length_based_hose', 'configured_assembly')),
  CONSTRAINT `quote_reference_discount_minimum_quantity` CHECK (`minimum_quantity` BETWEEN 1 AND 9999),
  CONSTRAINT `quote_reference_discount_percent` CHECK (`discount_percent` >= 0 AND `discount_percent` <= 100),
  CONSTRAINT `quote_reference_discount_version` CHECK (`record_version` >= 1)
);
--> statement-breakpoint
CREATE INDEX `quote_reference_discounts_lookup_idx`
ON `quote_reference_discounts` (`release_id`, `sku`, `line_kind`, `minimum_quantity` DESC);
--> statement-breakpoint
UPDATE `application_schema_state`
SET `version` = 27, `updated_at` = CURRENT_TIMESTAMP
WHERE `singleton` = 1;
